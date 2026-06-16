// Benchmark each relay in its own exclusive time window. Each rbuilder is wired
// to one relay; per builder we bring contender up against it, let it run the
// window, tear it down, then the next — so the relays are loaded one at a time,
// never simultaneously. After both windows we query Prometheus over each
// window's [start,end] and print a per-relay comparison.
//
// Wired into multi-relay-bench as a scripts[] entry: `decker up multi-relay-bench`
// runs the devnet + the benchmark, then leaves the devnet (with Prometheus +
// Grafana) up for inspection.

import { down } from "../commands/down.ts";
import { upRecipe } from "../commands/up.ts";
import { contenderBench } from "../recipes/contender-bench.ts";
import type { Recipe, Script } from "../utils/types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const PROM = "http://localhost:9009";
const EL_RPC = "http://localhost:8545";
const WINDOW_SECONDS = 90;

type Builder = { name: string; rpc: string; relay: string; privKey: string };
// Spam each builder's EL mempool (el-2's rpc is port-shifted to 18545); its
// rbuilder builds non-empty blocks from there and submits to its relay every
// slot — so the relay submission metrics record regardless of whether that block
// wins or loses to a local-fallback block (verified: a run had 27 submissions vs
// 1 win). Sending raw txs straight to the rbuilder jsonrpc is rejected by its
// orderflow validation ("insufficient funds"), and isn't needed for these
// metrics. Each window uses its own prefunded account (anvil #4/#5; lower indices
// are dirtied by rbuilder/decker test/earlier runs) via --override-senders.
const BUILDERS: Builder[] = [
  {
    name: "rbuilder-1",
    rpc: "http://el-1:8545",
    relay: "helix-1",
    privKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  },
  {
    name: "rbuilder-2",
    rpc: "http://el-2:18545",
    relay: "mev-boost-relay-1",
    privKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  },
];

type Window = { builder: string; relay: string; startSec: number; endSec: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function blockNumber(): Promise<number> {
  const r = await fetch(EL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return parseInt((await r.json()).result, 16);
}

// scripts[] fires right after pods start, before the chain is producing — wait
// until blocks advance past genesis so the windows measure real activity.
async function waitForLive(deadlineMs: number): Promise<void> {
  let last = -1;
  while (Date.now() < deadlineMs) {
    const n = await blockNumber().catch(() => -1);
    if (n > 0 && last >= 0 && n > last) return;
    last = n;
    await sleep(3000);
  }
  throw new Error("contender-compare: chain not producing blocks before deadline");
}

async function runWindow(b: Builder): Promise<Window> {
  const runtimeDir = `${DECKER_ROOT}/runtime/runs/${b.name}`;
  const startSec = Date.now() / 1000;
  const out = await upRecipe(
    b.name,
    contenderBench({ rpcUrl: b.rpc, duration: WINDOW_SECONDS, privKey: b.privKey }),
    undefined,
    { attached: true, runtimeDir },
  );
  if (out.code !== 0) throw new Error(`${b.name}: up failed (${out.code})`);

  await sleep(WINDOW_SECONDS * 1000);
  const endSec = Date.now() / 1000;

  const code = await down(runtimeDir);
  if (code !== 0) throw new Error(`${b.name}: down failed (${code})`);
  return { builder: b.name, relay: b.relay, startSec, endSec };
}

// One instant PromQL query evaluated at `atSec`; returns the scalar or null.
async function prom(expr: string, atSec: number): Promise<number | null> {
  const u = new URL(`${PROM}/api/v1/query`);
  u.searchParams.set("query", expr);
  u.searchParams.set("time", String(atSec));
  const r = await fetch(u).catch(() => null);
  if (!r || !r.ok) return null;
  const v = (await r.json())?.data?.result?.[0]?.value?.[1];
  return v == null ? null : Number(v);
}

async function windowStats(w: Window): Promise<Record<string, number | null>> {
  const W = `${WINDOW_SECONDS}s`;
  const r = `relay="${w.relay}"`;
  const hdr = `${r},endpoint=~".*/header/.*"`;
  const pay = `${r},endpoint=~".*blinded_blocks.*"`; // get_payload
  const at = w.endSec;
  const q = (expr: string) => prom(expr, at);
  // relay_submit_time is in ms; mev_boost_relay_latency is in seconds (→ ×1000).
  // submit_* (per bid) is dense; get_header/get_payload are called once per slot
  // by the single proposer, so those are sparse — p50 only, treat as rough.
  return {
    // --- relay performance: what the relay actually controls ---
    submit_p50_ms: await q(`histogram_quantile(0.5, sum(rate(relay_submit_time_bucket{${r}}[${W}])) by (le))`),
    submit_p99_ms: await q(`histogram_quantile(0.99, sum(rate(relay_submit_time_bucket{${r}}[${W}])) by (le))`),
    getheader_p50_ms: await q(`1000 * histogram_quantile(0.5, sum(rate(mev_boost_relay_latency_bucket{${hdr}}[${W}])) by (le))`),
    getpayload_p50_ms: await q(`1000 * histogram_quantile(0.5, sum(rate(mev_boost_relay_latency_bucket{${pay}}[${W}])) by (le))`),
    getpayload_fail_rate: await q(
      `sum(increase(mev_boost_relay_status_code_total{${pay},http_status_code!~"2.."}[${W}]))` +
        ` / clamp_min(sum(increase(mev_boost_relay_status_code_total{${pay}}[${W}])), 1)`,
    ),
    submit_error_rate: await q(
      `sum(increase(relay_errors{${r}}[${W}]))` +
        ` / clamp_min(sum(increase(relay_accepted_submissions{${r}}[${W}])), 1)`,
    ),
    // --- context only: load parity, not relay quality ---
    submissions: await q(`sum(increase(relay_accepted_submissions{${r}}[${W}]))`),
    bid_value_avg: await q(`sum(rate(mev_boost_bid_values_sum{${r}}[${W}])) / sum(rate(mev_boost_bid_values_count{${r}}[${W}]))`),
  };
}

export function contenderCompare(): Script {
  const run: Script = async (_recipe: Recipe) => {
    await waitForLive(Date.now() + 180_000);

    const windows: Window[] = [];
    for (const b of BUILDERS) {
      console.log(`window: ${b.relay} (via ${b.name}, ${WINDOW_SECONDS}s)`);
      windows.push(await runWindow(b));
    }

    await sleep(8000); // let the final scrape land
    console.log("\n=== relay comparison (per window) ===");
    for (const w of windows) {
      console.log(`${w.relay}:`, JSON.stringify(await windowStats(w)));
    }
  };
  Object.defineProperty(run, "name", { value: "contender-compare" });
  return run;
}

if (import.meta.main) {
  await contenderCompare()({} as Recipe);
}
