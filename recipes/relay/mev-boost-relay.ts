import type { Recipe } from "../../utils/types.ts";
import { relayWarmup } from "../../scripts/relay-warmup.ts";
import { rbuilderContainers } from "../../containers/rbuilder.ts";

// A single-relay devnet: one proposer (beacon-1 + validator-1) and one builder
// (rbuilder-1) on the proposer's EL (el-1, always at head), bidding into
// mev-boost-relay-1 only — plus the relay's postgres/redis/housekeeper and
// observability. mev-boost-relay uses el-1 as its blocksim, so there's no second
// beacon; beacon-1 runs solo. Run this and the helix sibling and compare; see
// recipes/relay-bench.ts.

const MEV_BOOST_RELAY_PUBKEY =
  "0xa1885d66bef164889a2e35845c3b626545d7b0e513efe335e97c3a45e534013fa3bc38c3b7e6143695aecc4872ac52c4";

// mev-boost-relay optimistic mode is enabled at runtime (the bench POSTs builder
// status + collateral to its --internal-api), so the recipe is identical whether or
// not optimistic; `optimistic` is accepted only to match the helix factory. ssz
// makes the builders submit SSZ; builders = how many distinct builders. prometheus
// scrapes the relay's own /metrics (port 9062) on top of the cross-checks.
export function mevBoostRelayRecipe(
  opts: { optimistic?: boolean; ssz?: boolean; builders?: number; realSim?: boolean } = {},
): Recipe {
  // realSim (default true) validates via the real reth (el-1) — required for synchronous
  // mode, where sim is on the bid path, and for any honest sim cost. realSim:false uses the
  // always-valid mock-simulator (only for the synthetic spammer, whose forged blocks real
  // reth would reject).
  const realSim = opts.realSim ?? true;
  return {
    artifacts: { generator: "l1", fork: "fulu" },
    // Pre-register validators so the builder can bid from slot 0 instead of waiting
    // out the cold-start.
    scripts: [relayWarmup({ relays: [{ container: "mev-boost-relay-1" }] })],
    pods: [
      {
        name: "el-1",
        shareProcessNamespace: true,
        containers: [
          { name: "el-1", prototype: "reth" },
          ...rbuilderContainers("mev-boost-relay-1", opts.builders ?? 1, opts.ssz ?? false),
        ],
      },
      {
        name: "beacon-1",
        containers: [
          {
            name: "beacon-1",
            prototype: "lighthouse-beacon",
            refs: { el: "el-1", builder: "mev-boost-1" },
            config: { peers: [] },
          },
        ],
      },
      {
        name: "validator-1",
        containers: [{ name: "validator-1", prototype: "lighthouse-validator", refs: { beacon: "beacon-1" } }],
      },
      {
        name: "mev-boost-1",
        containers: [
          {
            name: "mev-boost-1",
            prototype: "mev-boost",
            config: { relays: [{ name: "mev-boost-relay-1", pubkey: MEV_BOOST_RELAY_PUBKEY }] },
          },
        ],
      },
      {
        name: "mev-boost-relay-1",
        containers: [
          { name: "pg-mb-1", prototype: "mev-boost-relay-postgres" },
          { name: "redis-mb-1", prototype: "redis" },
          {
            name: "housekeeper-mb-1",
            prototype: "mev-boost-housekeeper",
            refs: { beacon: "beacon-1", postgres: "pg-mb-1", redis: "redis-mb-1" },
          },
          {
            name: "mev-boost-relay-1",
            prototype: "mev-boost-relay",
            // blocksim = el-1 (real reth) so sim does real validation work; with
            // optimistic=false the relay waits on it before responding (synchronous mode).
            refs: { beacon: "beacon-1", postgres: "pg-mb-1", redis: "redis-mb-1", el: realSim ? "el-1" : "mock-sim-1" },
            config: { optimistic: opts.optimistic },
          },
        ],
      },
      ...(realSim ? [] : [{
        name: "mock-sim-1",
        containers: [{ name: "mock-sim-1", prototype: "mock-simulator" }],
      }]),
      {
        name: "prometheus-1",
        containers: [{
          name: "prometheus-1",
          prototype: "prometheus",
          config: {
            scrape: [
              { job: "mev-boost-relay", ref: "mev-boost-relay-1", port: "http", path: "/metrics" },
              // rbuilder only exists when builders > 0 (the synthetic spammer replaces it).
              ...((opts.builders ?? 1) > 0
                ? [{ job: "rbuilder-1", ref: "rbuilder-1", port: "full_telemetry", path: "/debug/metrics/prometheus" }]
                : []),
              { job: "mev-boost", ref: "mev-boost-1", port: "metrics" },
            ],
          },
        }],
      },
      { name: "grafana-renderer-1", containers: [{ name: "grafana-renderer-1", prototype: "grafana-renderer" }] },
      {
        name: "grafana-1",
        containers: [{ name: "grafana-1", prototype: "grafana", refs: { prometheus: "prometheus-1", renderer: "grafana-renderer-1" } }],
      },
    ],
  };
}

export const recipe = mevBoostRelayRecipe();
