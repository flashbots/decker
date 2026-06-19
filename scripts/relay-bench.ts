// Relay performance benchmark. For each relay × {sync, optimistic} it brings up a
// fresh isolated devnet, loads the one builder, and measures the relay from its
// OWN native metrics (helix:9500 / mev-boost-relay:9062/metrics) — relay-internal
// processing, not the builder's round-trip. The four axes: submitBlock ingest
// latency (p50), tail (p99), throughput (subs/s), and getHeader serve latency
// (client-side, header_delay normalized off). The optimistic→sync delta per relay
// is the value prop: with sim off the critical path, ingest latency should
// collapse. Driven by recipes/relay-bench.ts.

import { down } from "../commands/down.ts";
import { upRecipe } from "../commands/up.ts";
import { contenderBench } from "../recipes/contender-bench.ts";
import { RELAY_BUILDER_PUBKEY } from "../containers/rbuilder.ts";
import type { Recipe, Script } from "../utils/types.ts";

type Mode = "sync" | "optimistic";

type Stats = Record<string, number | null>;

// One relay under test. `makeRecipe(optimistic)` builds its single-relay devnet;
// `stats`/`submitCountExpr`/`optimisticEngagedExpr` are relay-specific because
// helix and mev-boost-relay expose entirely different native metric names.
// `prepareOptimistic` is the runtime enable step (mev-boost-relay only — helix
// enables optimistic at config time via the recipe).
type Target = {
  name: string;
  label: string;
  relayPort: number;
  makeRecipe: (optimistic: boolean) => Recipe;
  stats: (mode: Mode, startSec: number, endSec: number) => Promise<Stats>;
  submitCountExpr: (mode: Mode) => string;
  optimisticEngagedExpr: string;
  prepareOptimistic?: (relayBase: string, deadlineMs: number) => Promise<boolean>;
};

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const PROM = "http://localhost:9009";
const EL_RPC = "http://localhost:8545";
const BEACON = "http://localhost:3500";
// Measurement window once submits are flowing in the target mode. The one builder
// submits only ~1–2×/slot, so the window is long enough to gather a usable sample
// for p50 (tails stay sample-limited — see the plan's single-builder caveat).
const WINDOW_SECONDS = 90;
// With txsUrl feeding the builder directly (see measureOne), the builder resubmits
// on incoming orders, so even a low TPS yields a dense, steady stream of accepted
// submissions (~9/s at tps 20). Higher TPS just floods the relay into 400/500s and
// stalls it — tps 20 stays dense and clean.
const LOAD_TPS = 20;
// Prefunded anvil account #4 — each relay gets a fresh devnet, so it starts clean.
const FUNDER = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
// The single devnet validator's pubkey — the proposer for every slot.
const PROPOSER_PUBKEY =
  "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";
// 1e24 wei (1M ETH) — clears any devnet bid value for optimistic collateral.
const BIG_COLLATERAL = "1000000000000000000000000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

async function blockNumber(): Promise<number> {
  const r = await fetch(EL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return parseInt((await r.json()).result, 16);
}

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

async function prom(expr: string, atSec: number): Promise<number | null> {
  const u = new URL(`${PROM}/api/v1/query`);
  u.searchParams.set("query", expr);
  u.searchParams.set("time", String(atSec));
  const r = await fetch(u).catch(() => null);
  if (!r || !r.ok) return null;
  const v = (await r.json())?.data?.result?.[0]?.value?.[1];
  return v == null ? null : Number(v);
}

// Wait until a counter expr is present and > 0 (the relay's fresh prometheus has
// scraped the submit series in this mode), so window-scoped queries aren't read
// before the data exists. Returns whether it appeared.
async function waitForExpr(expr: string, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    const n = await prom(expr, Date.now() / 1000);
    if (n != null && n > 0) return true;
    await sleep(2000);
  }
  return false;
}

// --- getHeader serve, measured client-side so it's identical for both relays ---
async function headSlot(): Promise<number | null> {
  const r = await fetch(`${BEACON}/eth/v1/beacon/headers/head`).catch(() => null);
  if (!r || !r.ok) return null;
  const s = (await r.json())?.data?.header?.message?.slot;
  return s == null ? null : Number(s);
}

async function headHash(): Promise<string | null> {
  const r = await fetch(EL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json())?.result?.hash ?? null;
}

// Hammer the relay's getHeader directly (slot+1 on the head, proposer pubkey),
// timing each 200 client-side. header_delay is off (recipe), so this is raw serve
// latency. Dense (~1/40ms) so p50/p99 are well-sampled regardless of submit rate.
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

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}

// --- native-metric query helpers ---
// Build a series selector. mev-boost-relay's OTEL namespace keeps a hyphen
// ("mev-boost-relay_…"), which isn't a legal bare PromQL metric name, so such
// names must go through the {__name__="…"} form (prometheus 3 UTF-8 names).
function sel(name: string, labels?: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return labels ? `${name}{${labels}}` : name;
  return `{__name__=${JSON.stringify(name)}${labels ? `,${labels}` : ""}}`;
}

// Each devnet boots fresh, so the CUMULATIVE histogram since boot is exactly this
// run's distribution — no rate/window, which is what made sparse single-builder
// submits read as spurious nulls. scale converts the histogram's unit to ms
// (helix is seconds → 1000, mev-boost-relay is already milliseconds → 1).
async function quant(bucketSel: string, p: number, atSec: number, scale: number): Promise<number | null> {
  const v = await prom(`histogram_quantile(${p}, sum(${bucketSel}) by (le))`, atSec);
  return v == null || !isFinite(v) ? null : round3(v * scale);
}

async function avg(sumSel: string, countSel: string, atSec: number, scale: number): Promise<number | null> {
  const s = await prom(`sum(${sumSel})`, atSec);
  const c = await prom(`sum(${countSel})`, atSec);
  if (s == null || c == null || c === 0) return null;
  return round3((s / c) * scale);
}

async function total(countSel: string, atSec: number): Promise<number | null> {
  const v = await prom(`sum(${countSel})`, atSec);
  return v == null ? null : Math.round(v);
}

// --- helix: histograms in SECONDS; submitBlock=/relay/v1/builder/blocks,
//     getHeader=/eth/v1/builder/header/...; optimistic via is_optimistic label. ---
const HELIX_SUBMIT = `endpoint="/relay/v1/builder/blocks"`;
async function helixStats(_mode: Mode, _startSec: number, endSec: number): Promise<Stats> {
  const at = endSec;
  return {
    submit_p50_ms: await quant(sel("helix_request_latency_secs_bucket", HELIX_SUBMIT), 0.5, at, 1000),
    submit_p99_ms: await quant(sel("helix_request_latency_secs_bucket", HELIX_SUBMIT), 0.99, at, 1000),
    submit_n: await total(sel("helix_request_latency_secs_count", HELIX_SUBMIT), at),
    submit_sim_ms: await avg(
      sel("helix_submission_trace_latency_us_sum", `step="simulation"`),
      sel("helix_submission_trace_latency_us_count", `step="simulation"`),
      at,
      0.001,
    ),
  };
}

// --- mev-boost-relay: histograms in MILLISECONDS; submit latency carries an
//     optimistic="true|false" label (each run is one mode, so filter by it). ---
const MBR_SUBMIT = "mev-boost-relay_submit_new_block_latency_milliseconds";
const MBR_SIM = "mev-boost-relay_submit_new_block_simulation_latency_milliseconds";
async function mbrStats(mode: Mode, _startSec: number, endSec: number): Promise<Stats> {
  const at = endSec;
  const optSel = mode === "optimistic" ? `optimistic="true"` : `optimistic="false"`;
  return {
    submit_p50_ms: await quant(sel(`${MBR_SUBMIT}_bucket`, optSel), 0.5, at, 1),
    submit_p99_ms: await quant(sel(`${MBR_SUBMIT}_bucket`, optSel), 0.99, at, 1),
    submit_n: await total(sel(`${MBR_SUBMIT}_count`, optSel), at),
    submit_sim_ms: await avg(sel(`${MBR_SIM}_sum`), sel(`${MBR_SIM}_count`), at, 1),
  };
}

// mev-boost-relay records a builder only after it submits, and reads optimistic
// status from a per-slot cache rebuilt from the DB. So: wait for the builder to be
// in the DB, POST high_prio+optimistic+collateral via --internal-api, then wait a
// couple slots for the cache to pick it up. (helix needs none of this — its
// builders[] config marks the builder optimistic from boot.)
async function enableMbrOptimistic(relayBase: string, deadlineMs: number): Promise<boolean> {
  const pk = RELAY_BUILDER_PUBKEY;
  while (Date.now() < deadlineMs) {
    const r = await fetch(`${relayBase}/internal/v1/builder/${pk}`).catch(() => null);
    if (r && r.ok) {
      const d = await r.json().catch(() => null);
      if (d && Number(d.num_submissions_total ?? 0) > 0) break;
    }
    await sleep(3000);
  }
  await fetch(`${relayBase}/internal/v1/builder/${pk}?high_prio=true&optimistic=true`, { method: "POST" }).catch(() => {});
  await fetch(`${relayBase}/internal/v1/builder/collateral/${pk}?collateral=${BIG_COLLATERAL}&value=${BIG_COLLATERAL}`, {
    method: "POST",
  }).catch(() => {});
  await sleep(26000); // ~2 slots for prepareBuildersForSlot to rebuild the cache
  return true;
}

async function measureOne(t: Target, mode: Mode): Promise<{ col: string; stats: Stats }> {
  const optimistic = mode === "optimistic";
  const tag = `${t.name}-${mode}`;
  const devDir = `${DECKER_ROOT}/runtime/runs/${tag}`;
  const loadDir = `${DECKER_ROOT}/runtime/runs/${tag}-load`;
  const relayBase = `http://localhost:${t.relayPort}`;

  const up = await upRecipe(tag, t.makeRecipe(optimistic), undefined, { attached: true, runtimeDir: devDir });
  if (up.code !== 0) throw new Error(`${tag}: devnet up failed (${up.code})`);
  await waitForLive(Date.now() + 180_000);

  // Load must cover the optimistic-enable prep (mev-boost-relay: builder-in-DB
  // wait + cache refresh) plus the whole window, with slack so it can't end mid-window.
  const needsPrep = optimistic && !!t.prepareOptimistic;
  const prepBudgetSec = needsPrep ? 45 : 0;
  const loadDur = (needsPrep ? 100 : 10) + WINDOW_SECONDS;
  const load = await upRecipe(
    `${tag}-load`,
    // txsUrl feeds raw txs straight to the builder's order pool so it builds
    // non-empty, above-floor blocks and submits to the relay every slot — without
    // it the builder's blocks are ~empty and the relay accepts almost nothing.
    contenderBench({
      rpcUrl: "http://el-1:8545",
      txsUrl: "http://rbuilder-1:8745",
      duration: loadDur,
      privKey: FUNDER,
      tps: LOAD_TPS,
    }),
    undefined,
    { attached: true, runtimeDir: loadDir },
  );
  if (load.code !== 0) throw new Error(`${tag}: load up failed (${load.code})`);

  if (needsPrep) await t.prepareOptimistic!(relayBase, Date.now() + prepBudgetSec * 1000);

  // Open the window only once submits are flowing in this mode.
  await waitForExpr(t.submitCountExpr(mode), Date.now() + 60_000);
  const startSec = Date.now() / 1000;
  const [, reads] = await Promise.all([
    sleep(WINDOW_SECONDS * 1000),
    hammerReads(t.relayPort, Date.now() + WINDOW_SECONDS * 1000),
  ]);
  await down(loadDir);

  await sleep(8000); // let the last scrape land
  const present = await waitForExpr(t.submitCountExpr(mode), Date.now() + 30_000);
  const metricEnd = Date.now() / 1000;
  if (!present) console.log(`  [warn] ${tag}: no submissions in this mode`);

  const stats = await t.stats(mode, startSec, metricEnd);
  stats.get_header_p50_ms = pct(reads, 0.5);
  stats.get_header_p99_ms = pct(reads, 0.99);
  stats.get_header_n = reads.length;
  const engaged = await prom(t.optimisticEngagedExpr, metricEnd);
  stats.optimistic_engaged = engaged && engaged > 0 ? 1 : 0;
  if (optimistic && !stats.optimistic_engaged) console.log(`  [warn] ${tag}: optimistic did NOT engage`);

  await down(devDir);
  return { col: `${t.label}/${optimistic ? "opt" : "sync"}`, stats };
}

// Display order: submit (ingest p50, tail p99, throughput, sim component), then
// getHeader serve, then the optimistic-engaged flag.
const METRIC_ROWS = [
  "submit_p50_ms",
  "submit_p99_ms",
  "submit_n",
  "submit_sim_ms",
  "get_header_p50_ms",
  "get_header_p99_ms",
  "get_header_n",
  "optimistic_engaged",
] as const;

function fmtVal(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

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

  // The value prop: optimistic→sync submit-ingest delta per relay.
  console.log("\nsubmit_p50 sync → opt (the optimistic win):");
  const by = new Map(results.map((r) => [r.col, r.stats.submit_p50_ms]));
  for (const label of new Set(results.map((r) => r.col.split("/")[0]))) {
    const s = by.get(`${label}/sync`);
    const o = by.get(`${label}/opt`);
    const delta = s != null && o != null ? `${(s - o).toFixed(1)}ms faster (${(s / o).toFixed(1)}×)` : "n/a";
    console.log(`  ${label}: ${fmtVal(s ?? null)} → ${fmtVal(o ?? null)}   ${delta}`);
  }
}

export function benchmarkRelays(targets: Target[]): Script {
  const run: Script = async (_recipe: Recipe) => {
    const modes: Mode[] = ["sync", "optimistic"];
    const results: { col: string; stats: Stats }[] = [];
    for (const t of targets) {
      for (const mode of modes) {
        console.log(`\n──── ${t.name} / ${mode} ────`);
        results.push(await measureOne(t, mode));
      }
    }
    printComparison(results);

    // The benchmark is a job, not a standing devnet — tear down the parent's own
    // dozzle so the next `decker up relay-bench` doesn't collide on it.
    await down();
  };
  Object.defineProperty(run, "name", { value: "relay-bench" });
  return run;
}

// Build the two targets from the relay recipe factories.
export async function defaultTargets(): Promise<Target[]> {
  const { helixRecipe } = await import("../recipes/relay/helix.ts");
  const { mevBoostRelayRecipe } = await import("../recipes/relay/mev-boost-relay.ts");
  return [
    {
      name: "helix",
      label: "helix-1",
      relayPort: 4040,
      makeRecipe: (optimistic) => helixRecipe({ optimistic }),
      stats: helixStats,
      submitCountExpr: () => `sum(${sel("helix_request_latency_secs_count", HELIX_SUBMIT)})`,
      optimisticEngagedExpr: `sum(helix_simulator_count_total{is_optimistic="true"})`,
    },
    {
      name: "mev-boost-relay",
      label: "mev-boost-relay-1",
      relayPort: 9062,
      makeRecipe: (optimistic) => mevBoostRelayRecipe({ optimistic }),
      stats: mbrStats,
      submitCountExpr: (mode) =>
        `sum(${sel(`${MBR_SUBMIT}_count`, `optimistic="${mode === "optimistic" ? "true" : "false"}"`)})`,
      optimisticEngagedExpr: `sum(${sel(`${MBR_SUBMIT}_count`, `optimistic="true"`)})`,
      prepareOptimistic: enableMbrOptimistic,
    },
  ];
}

if (import.meta.main) {
  await benchmarkRelays(await defaultTargets())({} as Recipe);
}
