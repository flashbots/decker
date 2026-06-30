// Relay performance benchmark: helix vs mev-boost-relay.
//
// For every (relay × MODE × VARIANT) cell it boots a fresh isolated devnet and measures two
// axes CLIENT-SIDE, with the same clock for both relays:
//   • submit delay  — the relay spammer times each submitBlock POST→response (avg/p50/p99 RTT)
//   • getHeader     — a client hammer times getHeader (p50/p99)
// The spammer is the ONLY submission source, so submit RTT is a pure client→relay roundtrip.
//
// Each relay's native metrics are also scraped as a SUPPLEMENTARY decomposition (helix's
// request_latency; mev-boost-relay's per-phase histograms) to show WHERE the roundtrip goes —
// but the headline is always the RTT. Driven by recipes/relay-bench.ts.

import { down } from "../commands/down.ts";
import { upRecipe } from "../commands/up.ts";
import { BUILDER_KEYS } from "../containers/rbuilder.ts";
import { spamRelay } from "./relay-spammer.ts";
import type { Recipe, Script } from "../utils/types.ts";

// ═══════════════════════════════════════ types ═══════════════════════════════════════

type Stats = Record<string, number | null>;
type RecipeOpts = { optimistic: boolean; ssz: boolean; builders: number; realSim?: boolean };

// synchronous = the relay simulates before responding (sim on the bid path).
// optimistic  = the relay responds first, with simulation off the bid path.
type Mode = "synchronous" | "optimistic";

// One workload applied to every cell. The spammer drives load: txsPerBlock = forged block
// size, perSlot = submissions fired per slot.
type Variant = { name: string; txsPerBlock: number; perSlot?: number };

// One relay under test. `stats` and `optimisticEngagedExpr` are relay-specific because helix
// and mev-boost-relay expose entirely different native metrics. `prepareOptimistic` is a
// runtime optimistic-enable (mev-boost-relay only; helix enables it via the recipe).
type Target = {
  name: string;
  label: string;
  relayPort: number;
  beaconUrl: string; // beacon the spammer reads payload_attributes from (this relay's chain view)
  makeRecipe: (opts: RecipeOpts) => Recipe;
  stats: (endSec: number, optimistic: boolean) => Promise<Stats>;
  optimisticEngagedExpr: string;
  prepareOptimistic?: (relayBase: string, pubkeys: string[], deadlineMs: number) => Promise<boolean>;
};

// ══════════════════════════════════════ config ══════════════════════════════════════
// The matrix to run, plus the simulator toggle — the knobs you actually touch.

// Which modes to benchmark; list both for the full 2×2.
const MODES: Mode[] = ["synchronous", "optimistic"];

// false = mock simulator (instant, always-valid): isolates relay overhead, reproducible, and
// lets the spammer's forged blocks through. true = real sim (el-1 / helix-sim-1): adds each
// relay's real validation cost, but REJECTS the spammer's forged blocks (see measureOne).
const REAL_SIM = false;

const VARIANTS: Variant[] = [
  { name: "200tx", txsPerBlock: 200, perSlot: 50 },
];

// How long to spam per cell (dense enough for a stable RTT distribution).
const WINDOW_SECONDS = 60;

// ── fixed devnet facts: host ports the recipes expose, and the single proposer ──
const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const PROM = "http://localhost:9009";
const EL_RPC = "http://localhost:8545"; // el-1, shared by both relays' builders
const CHAIN_BEACON = "http://localhost:3500"; // beacon-1 — canonical chain head for the getHeader hammer
const PROPOSER_PUBKEY =
  "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";
const BIG_COLLATERAL = "1000000000000000000000000"; // 1M ETH — clears any devnet bid for optimistic collateral

// ══════════════════════════════════════ helpers ══════════════════════════════════════

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
const fromHex = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g)!.map((b) => parseInt(b, 16)));

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}

// The spammer submits as a single builder. With builders:0 the recipe configures exactly one
// builder pubkey (helix via Math.max(builders,1); mev-boost-relay registers it on first submit).
const SPAM_KEYS = BUILDER_KEYS.slice(0, 1).map((k) => ({ priv: k.key, pub: k.pubkey }));

function genesisForkVersion(): Uint8Array {
  const txt = Deno.readTextFileSync(`${DECKER_ROOT}/runtime/artifacts/testnet/config.yaml`);
  return fromHex(txt.match(/GENESIS_FORK_VERSION:\s*(0x[0-9a-fA-F]+)/)![1]);
}

// ════════════════════════════════ devnet readiness ════════════════════════════════

async function blockNumber(): Promise<number> {
  const r = await fetch(EL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return parseInt((await r.json()).result, 16);
}

// Resolve once the chain is producing blocks.
async function waitForLive(deadlineMs: number): Promise<void> {
  let last = -1;
  while (Date.now() < deadlineMs) {
    const n = await blockNumber().catch(() => -1);
    if (n > 0 && last >= 0 && n > last) return;
    last = n;
    await sleep(3000);
  }
  throw new Error("relay-bench: chain not producing before deadline");
}

// Resolve once the relay knows its proposer duties (so the spammer can build valid submissions).
async function dutiesReady(relayBase: string, deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    const r = await fetch(`${relayBase}/relay/v1/builder/validators`).catch(() => null);
    if (r?.ok) {
      const a = await r.json().catch(() => []);
      if (Array.isArray(a) && a.length) return;
    }
    await sleep(3000);
  }
  throw new Error("relay-bench: builder duties not ready before deadline");
}

// ════════════════════════════ getHeader serve (client hammer) ════════════════════════════
// Hammer the relay's getHeader (slot+1 on the chain head) and time each 200 client-side.
// header_delay is off in the recipe, so this is raw serve latency. Dense enough (~1/40ms) for
// well-sampled p50/p99 regardless of submit rate.

async function headSlot(): Promise<number | null> {
  const r = await fetch(`${CHAIN_BEACON}/eth/v1/beacon/headers/head`).catch(() => null);
  if (!r?.ok) return null;
  const s = (await r.json())?.data?.header?.message?.slot;
  return s == null ? null : Number(s);
}

async function headHash(): Promise<string | null> {
  const r = await fetch(EL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json())?.result?.hash ?? null;
}

async function hammerReads(relayPort: number, deadlineMs: number): Promise<number[]> {
  const out: number[] = [];
  let slot = 0;
  let parent = "";
  let refreshed = 0;
  while (Date.now() < deadlineMs) {
    if (Date.now() - refreshed > 1000) {
      const s = await headSlot().catch(() => null);
      const p = await headHash().catch(() => null);
      if (s != null) slot = s + 1;
      if (p) parent = p;
      refreshed = Date.now();
    }
    if (slot && parent) {
      const url = `http://localhost:${relayPort}/eth/v1/builder/header/${slot}/${parent}/${PROPOSER_PUBKEY}`;
      const t0 = performance.now();
      const r = await fetch(url).catch(() => null);
      const dt = performance.now() - t0;
      if (r) {
        if (r.ok) out.push(dt);
        await r.body?.cancel().catch(() => {});
      }
    }
    await sleep(40);
  }
  return out;
}

// ══════════════════════ SUPPLEMENTARY: native-metric decomposition ══════════════════════
// Scraped from each relay's own prometheus to show WHERE the roundtrip goes. Not the headline.

async function prom(expr: string, atSec: number): Promise<number | null> {
  const u = new URL(`${PROM}/api/v1/query`);
  u.searchParams.set("query", expr);
  u.searchParams.set("time", String(atSec));
  const r = await fetch(u).catch(() => null);
  if (!r?.ok) return null;
  const v = (await r.json())?.data?.result?.[0]?.value?.[1];
  return v == null ? null : Number(v);
}

// Each devnet is fresh, so a histogram's cumulative sum/count since boot IS this run's
// distribution. avg = (sum/count)·scale converts to ms (helix is seconds → 1000; mbr is ms → 1).
async function avg(sumSel: string, countSel: string, atSec: number, scale: number): Promise<number | null> {
  const s = await prom(`sum(${sumSel})`, atSec);
  const c = await prom(`sum(${countSel})`, atSec);
  if (s == null || c == null || c === 0) return null;
  return round3((s / c) * scale);
}

// Plain bare-name PromQL selector (used for helix's clean metric names).
function sel(name: string, labels?: string): string {
  return labels ? `${name}{${labels}}` : name;
}

// --- helix: request_latency_secs spans handler-start → response. In optimistic mode the
//     response resolves right at the bid sort (sim/payload-store deferred), so its mean is
//     bid-available; in synchronous mode it natively includes the sim wait. ---
const HELIX_SUBMIT = `endpoint="/relay/v1/builder/blocks"`;
async function helixStats(endSec: number, _optimistic: boolean): Promise<Stats> {
  return {
    submit_bidavail_ms: await avg(
      sel("helix_request_latency_secs_sum", HELIX_SUBMIT),
      sel("helix_request_latency_secs_count", HELIX_SUBMIT),
      endSec,
      1000,
    ),
  };
}

// --- mev-boost-relay: per-phase histograms (ms). MBR_PHASES is the display order; MBR_BIDAVAIL
//     is the subset whose means sum to "bid-available" (when the bid can win) — sim is added in
//     synchronous mode. database_save and the total are off the bid path (deferred after the
//     response is built). The OTEL exporter's metric-name separator varies by version
//     (mev-boost-relay_ vs mev_boost_relay_), so series are matched by an __name__ regex; the
//     displayed labels use the canonical underscore form. ---
const MBR_PHASES = [
  "submit_new_block_read_latency",
  "submit_new_block_decode_latency",
  "submit_new_block_prechecks_latency",
  "submit_new_block_simulation_latency",
  "submit_new_block_redis_latency",
  "submit_new_block_redis_payload_latency",
  "submit_new_block_redis_top_bid_latency",
  "submit_new_block_redis_floor_latency",
  "database_save_latency",
  "submit_new_block_latency",
] as const;
const MBR_BIDAVAIL = [
  "submit_new_block_read_latency",
  "submit_new_block_decode_latency",
  "submit_new_block_prechecks_latency",
  "submit_new_block_redis_latency",
];
const MBR_PHASE_NOTE: Record<string, string> = {
  submit_new_block_simulation_latency: "sim — on the bid path only in synchronous mode",
  submit_new_block_redis_payload_latency: "↳ redis sub-phase",
  submit_new_block_redis_top_bid_latency: "↳ redis sub-phase",
  submit_new_block_redis_floor_latency: "↳ redis sub-phase",
  database_save_latency: "deferred postgres write — gates the response (no Flush); off the bid path",
  submit_new_block_latency: "TOTAL — deferred-recorded; overshoots bid-available",
};

const mbrName = (base: string) => `mev_boost_relay_${base}_milliseconds`; // canonical display name
function mbrSel(base: string, suffix: "sum" | "count", labels?: string): string {
  const pat = `mev.boost.relay_${base}_milliseconds_${suffix}`; // `.` tolerates the -/_ separator
  return `{__name__=~${JSON.stringify(pat)}${labels ? `,${labels}` : ""}}`;
}
const mbrMean = (base: string, atSec: number) => avg(mbrSel(base, "sum"), mbrSel(base, "count"), atSec, 1);

async function mbrStats(endSec: number, optimistic: boolean): Promise<Stats> {
  const phases: Stats = {};
  for (const base of MBR_PHASES) phases[mbrName(base)] = await mbrMean(base, endSec);

  // bid-available = read+decode+prechecks+redis, plus the sim wait in synchronous mode.
  const bidavail = optimistic ? MBR_BIDAVAIL : [...MBR_BIDAVAIL, "submit_new_block_simulation_latency"];
  const parts = bidavail.map((b) => phases[mbrName(b)]).filter((x): x is number => x != null);
  return {
    submit_bidavail_ms: parts.length ? round3(parts.reduce((a, x) => a + x, 0)) : null,
    ...phases,
  };
}

// ═══════════════════════════ mev-boost-relay optimistic prep ═══════════════════════════
// mev-boost-relay only treats a builder as optimistic once it's marked via --internal-api, and
// it only knows a builder after that builder has submitted. So: wait for it to be recorded,
// POST high-prio + optimistic + collateral, then wait ~2 slots for the per-slot cache to refresh.
// (helix needs none of this — its builders[] config marks the builder optimistic from boot.)
async function enableMbrOptimistic(relayBase: string, pubkeys: string[], deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    const r = await fetch(`${relayBase}/internal/v1/builder/${pubkeys[0]}`).catch(() => null);
    if (r?.ok) {
      const d = await r.json().catch(() => null);
      if (d && Number(d.num_submissions_total ?? 0) > 0) break;
    }
    await sleep(3000);
  }
  for (const pk of pubkeys) {
    await fetch(`${relayBase}/internal/v1/builder/${pk}?high_prio=true&optimistic=true`, { method: "POST" }).catch(() => {});
    // Collateral via `value` only; leaving `collateral` empty keeps builder_id="", which makes
    // the relay skip demotion — so the builder stays optimistic under load.
    await fetch(`${relayBase}/internal/v1/builder/collateral/${pk}?value=${BIG_COLLATERAL}`, { method: "POST" }).catch(() => {});
  }
  await sleep(26000); // ~2 slots for the per-slot builder cache to rebuild
  return true;
}

// ═══════════════════════════════════ run one cell ═══════════════════════════════════

async function measureOne(t: Target, variant: Variant, mode: Mode): Promise<{ col: string; stats: Stats }> {
  const optimistic = mode === "optimistic";
  const tag = `${t.name}-${mode}-${variant.name}`;
  const devDir = `${DECKER_ROOT}/runtime/runs/${tag}`;
  const relayBase = `http://localhost:${t.relayPort}`;

  // builders:0 → no rbuilder, so the spammer is the only submission source and submit RTT is
  // the pure client→relay roundtrip.
  const up = await upRecipe(tag, t.makeRecipe({ optimistic, ssz: false, builders: 0, realSim: REAL_SIM }), undefined, {
    attached: true,
    runtimeDir: devDir,
  });
  if (up.code !== 0) throw new Error(`${tag}: devnet up failed (${up.code})`);
  await waitForLive(Date.now() + 180_000);
  await dutiesReady(relayBase, Date.now() + 60_000);

  const spamOpts = { relayUrl: relayBase, beaconUrl: t.beaconUrl, genesisForkVersion: genesisForkVersion(), builderKeys: SPAM_KEYS };

  // Optimistic mev-boost-relay needs its builder registered first — a short warm-up spam does
  // that, then prep marks it optimistic.
  if (optimistic && t.prepareOptimistic) {
    await spamRelay({ ...spamOpts, perSlot: 20, deadlineMs: Date.now() + 20_000 });
    await t.prepareOptimistic(relayBase, SPAM_KEYS.map((k) => k.pub), Date.now() + 45_000);
  }

  // Submit RTT (spammer) and getHeader (hammer), measured concurrently over the window.
  const deadline = Date.now() + WINDOW_SECONDS * 1000;
  const [sr, reads] = await Promise.all([
    spamRelay({ ...spamOpts, perSlot: variant.perSlot ?? 50, txsPerBlock: variant.txsPerBlock, deadlineMs: deadline }),
    hammerReads(t.relayPort, deadline),
  ]);

  // Supplementary native decomposition + the optimistic-engaged flag.
  const native = await t.stats(Date.now() / 1000, optimistic).catch(() => ({} as Stats));
  const engaged = await prom(t.optimisticEngagedExpr, Date.now() / 1000);

  const stats: Stats = {
    ...native,
    submit_rtt_avg_ms: sr.rttAvgMs ?? null,
    submit_rtt_p50_ms: sr.rttP50Ms ?? null,
    submit_rtt_p99_ms: sr.rttP99Ms ?? null,
    submit_n: sr.accepted,
    submit_rejected: sr.rejected ?? null,
    get_header_p50_ms: pct(reads, 0.5),
    get_header_p99_ms: pct(reads, 0.99),
    get_header_n: reads.length,
    optimistic_engaged: engaged && engaged > 0 ? 1 : 0,
  };
  if (sr.accepted === 0) console.log(`  [warn] ${tag}: 0 accepted (sent ${sr.sent}, rejected ${sr.rejected}) — forged blocks fail real sim`);
  if (optimistic && !stats.optimistic_engaged) console.log(`  [warn] ${tag}: optimistic did NOT engage`);

  await down(devDir);
  return { col: `${t.label}/${mode}`, stats };
}

// ════════════════════════════════════════ output ════════════════════════════════════════

// Headline table. The native bid-available and the mev-boost-relay phase decomposition are
// printed below it as supplementary analysis.
const METRIC_ROWS = [
  "submit_rtt_avg_ms",
  "submit_rtt_p50_ms",
  "submit_rtt_p99_ms",
  "submit_n",
  "submit_rejected",
  "get_header_p50_ms",
  "get_header_p99_ms",
  "get_header_n",
  "optimistic_engaged",
] as const;

const fmtVal = (v: number | null | undefined): string =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);

function printComparison(results: { col: string; stats: Stats }[]): void {
  const labelW = Math.max("metric".length, ...METRIC_ROWS.map((k) => k.length));
  const cols = results.map((res) => {
    const vals = METRIC_ROWS.map((k) => fmtVal(res.stats[k]));
    return { head: res.col, vals, width: Math.max(res.col.length, ...vals.map((v) => v.length)) };
  });
  const row = (label: string, cells: string[]) =>
    label.padEnd(labelW) + cols.map((c, i) => "  " + cells[i].padStart(c.width)).join("");

  console.log("\n=== relay comparison (latencies in ms) ===");
  console.log(row("metric", cols.map((c) => c.head)));
  METRIC_ROWS.forEach((k, ri) => console.log(row(k, cols.map((c) => c.vals[ri]))));
  console.log("\nsubmit_rtt_*_ms = client-timed submission roundtrip from the relay spammer (POST→response), same clock both relays.");

  // Per mode: the helix↔mev-boost-relay RTT ratio, then each relay's native decomposition.
  for (const mode of [...new Set(results.map((r) => r.col.split("/")[1]))]) {
    const sync = mode === "synchronous";
    const hx = results.find((r) => r.col === `helix-1/${mode}`);
    const mb = results.find((r) => r.col === `mev-boost-relay-1/${mode}`);
    const h = hx?.stats.submit_rtt_avg_ms;
    const m = mb?.stats.submit_rtt_avg_ms;
    if (h != null && m != null && h > 0) {
      console.log(`  [${mode}] submit RTT (avg): helix ${fmtVal(h)} vs mev-boost-relay ${fmtVal(m)}  (${(m / h).toFixed(1)}×)`);
    }

    // --- supplementary native analysis: where the time goes inside each relay ---
    if (hx?.stats.submit_bidavail_ms != null) {
      console.log(`      helix native request_latency (bid-available) = ${fmtVal(hx.stats.submit_bidavail_ms)} ms`);
    }
    if (mb) {
      console.log(`      mev-boost-relay native submit phases (mean ms, original metric names):`);
      for (const base of MBR_PHASES) {
        const note = MBR_PHASE_NOTE[base] ?? (MBR_BIDAVAIL.includes(base) ? "bid-available phase" : "");
        console.log(`        ${mbrName(base).padEnd(67)} ${fmtVal(mb.stats[mbrName(base)]).padStart(8)}  ${note}`);
      }
      const formula = sync ? "read+decode+prechecks+sim+redis" : "read+decode+prechecks+redis";
      console.log(`      → native bid-available (${formula}) = ${fmtVal(mb.stats.submit_bidavail_ms)} ms   [deferred DB writes excluded; cf. its RTT above]`);
    }
  }
}

// ═══════════════════════════════════════ entry ═══════════════════════════════════════

export function benchmarkRelays(targets: Target[]): Script {
  const run: Script = async (_recipe: Recipe) => {
    const results: { col: string; stats: Stats }[] = [];
    for (const mode of MODES) {
      for (const t of targets) {
        for (const variant of VARIANTS) {
          console.log(`\n──── ${t.name} / ${mode} / ${variant.name} ────`);
          results.push(await measureOne(t, variant, mode));
        }
      }
    }
    printComparison(results);
    // This is a job, not a standing devnet — tear down the parent's own dozzle so the next
    // `decker up relay-bench` doesn't collide on it.
    await down();
  };
  Object.defineProperty(run, "name", { value: "relay-bench" });
  return run;
}

export async function defaultTargets(): Promise<Target[]> {
  const { helixRecipe } = await import("../recipes/relay/helix.ts");
  const { mevBoostRelayRecipe } = await import("../recipes/relay/mev-boost-relay.ts");
  return [
    {
      name: "helix",
      label: "helix-1",
      relayPort: 4040,
      beaconUrl: "http://localhost:13500", // helix-beacon-1
      makeRecipe: (opts) => helixRecipe(opts),
      stats: helixStats,
      optimisticEngagedExpr: `sum(helix_simulator_count_total{is_optimistic="true"})`,
    },
    {
      name: "mev-boost-relay",
      label: "mev-boost-relay-1",
      relayPort: 9062,
      beaconUrl: "http://localhost:3500", // beacon-1
      makeRecipe: (opts) => mevBoostRelayRecipe(opts),
      stats: mbrStats,
      optimisticEngagedExpr: `sum(${mbrSel("submit_new_block_latency", "count", `optimistic="true"`)})`,
      prepareOptimistic: enableMbrOptimistic,
    },
  ];
}

if (import.meta.main) {
  await benchmarkRelays(await defaultTargets())({} as Recipe);
}
