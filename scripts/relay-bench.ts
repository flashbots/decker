// Parent benchmark: for each relay, bring up a fresh single-relay devnet, load
// the one builder, measure that relay over the load window, tear it down, then
// the next relay — so every relay runs in an identical, isolated topology with
// the whole devnet to itself. Driven by recipes/relay-bench.ts.

import { down } from "../commands/down.ts";
import { upRecipe } from "../commands/up.ts";
import { contenderBench } from "../recipes/contender-bench.ts";
import type { Recipe, Script } from "../utils/types.ts";

// One relay to benchmark: a name (runtime dir), the metric label its containers
// tag submissions with, the single-relay devnet recipe, and the relay's host
// get_header port (helix-1 4040, mev-boost-relay-1 9062) for direct read sampling.
export type Target = { name: string; label: string; recipe: Recipe; relayPort: number };

import { DECKER_ROOT } from "../utils/root.ts";
const PROM = "http://localhost:9009";
const EL_RPC = "http://localhost:8545";
// Floor for non-null submit metrics on a 12s-slot devnet: the builder needs ~2
// slots of load before it submits a non-empty block, so anything much smaller
// catches only the ramp and goes null. ~30s is the smallest that still measures.
const LOAD_SECONDS = 30;
// Prefunded anvil account #4 — each relay gets a fresh devnet, so it starts clean.
const FUNDER = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const BEACON = "http://localhost:3500";
// The single devnet validator's pubkey — the proposer for every slot.
const PROPOSER_PUBKEY =
  "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// relay_submit_time is in ms; mev_boost_relay_latency is in seconds (→ ×1000).
// submit_* (per bid) is dense; get_header/get_payload are per-slot, so sparse.
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

// Call the relay's builder-API get_header directly (slot+1 on the head, the
// proposer pubkey), timing each 200 client-side. This bypasses mev-boost's
// per-slot cache, so the read latency can be sampled densely in a short window.
// Refresh slot/parent ~1/s so the requests stay valid as the chain advances.
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

async function relayStats(relay: string, startSec: number, endSec: number): Promise<Record<string, number | null>> {
  const W = `${Math.max(15, Math.round(endSec - startSec))}s`;
  const r = `relay="${relay}"`;
  const q = (e: string) => prom(e, endSec);
  // Only metrics dense enough to be meaningful in a small window: these come per
  // bid submission (many per slot). get_header / get_payload / bid value are
  // per-slot (one proposer), so they'd always be too sparse for a short run — we
  // deliberately don't report them here.
  return {
    submit_p50_ms: await q(`histogram_quantile(0.5, sum(rate(relay_submit_time_bucket{${r}}[${W}])) by (le))`),
    submit_p99_ms: await q(`histogram_quantile(0.99, sum(rate(relay_submit_time_bucket{${r}}[${W}])) by (le))`),
    submit_error_rate: await q(
      `sum(increase(relay_errors{${r}}[${W}]))` +
        ` / clamp_min(sum(increase(relay_accepted_submissions{${r}}[${W}])), 1)`,
    ),
    submissions: await q(`sum(increase(relay_accepted_submissions{${r}}[${W}]))`),
  };
}

async function measureOneRelay(t: Target): Promise<{ relay: string; stats: Record<string, number | null> }> {
  const devDir = `${DECKER_ROOT}/runtime/runs/${t.name}`;
  const loadDir = `${DECKER_ROOT}/runtime/runs/${t.name}-load`;

  const up = await upRecipe(t.name, t.recipe, undefined, { attached: true, runtimeDir: devDir });
  if (up.code !== 0) throw new Error(`${t.name}: devnet up failed (${up.code})`);
  await waitForLive(Date.now() + 180_000);

  const startSec = Date.now() / 1000;
  const load = await upRecipe(
    `${t.name}-load`,
    contenderBench({ rpcUrl: "http://el-1:8545", duration: LOAD_SECONDS, privKey: FUNDER }),
    undefined,
    { attached: true, runtimeDir: loadDir },
  );
  if (load.code !== 0) throw new Error(`${t.name}: load up failed (${load.code})`);
  // While contender loads, hammer the relay's get_header directly for dense
  // read-latency samples.
  const [, reads] = await Promise.all([
    sleep(LOAD_SECONDS * 1000),
    hammerReads(t.relayPort, Date.now() + LOAD_SECONDS * 1000),
  ]);
  const endSec = Date.now() / 1000;
  await down(loadDir);

  await sleep(8000); // let the last scrape land
  const stats = await relayStats(t.label, startSec, endSec);
  stats.read_p50_ms = pct(reads, 0.5);
  stats.read_p99_ms = pct(reads, 0.99);
  stats.read_samples = reads.length;

  await down(devDir);
  return { relay: t.label, stats };
}

export function benchmarkRelays(targets: Target[]): Script {
  const run: Script = async (_recipe: Recipe) => {
    const results: { relay: string; stats: Record<string, number | null> }[] = [];
    for (const t of targets) {
      console.log(`\n──── ${t.name} ────`);
      results.push(await measureOneRelay(t));
    }
    console.log("\n=== relay comparison ===");
    for (const res of results) console.log(`${res.relay}:`, JSON.stringify(res.stats));

    // The benchmark is a job, not a standing devnet — tear down the parent's own
    // dozzle so the next `decker up relay-bench` doesn't collide on it.
    await down();
  };
  Object.defineProperty(run, "name", { value: "relay-bench" });
  return run;
}

if (import.meta.main) {
  const helix = (await import("../recipes/relay/helix.ts")).recipe;
  const mevBoostRelay = (await import("../recipes/relay/mev-boost-relay.ts")).recipe;
  await benchmarkRelays([
    { name: "helix", label: "helix-1", recipe: helix, relayPort: 4040 },
    { name: "mev-boost-relay", label: "mev-boost-relay-1", recipe: mevBoostRelay, relayPort: 9062 },
  ])({} as Recipe);
}
