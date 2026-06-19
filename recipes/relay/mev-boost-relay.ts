import type { Recipe } from "../../utils/types.ts";
import { relayWarmup } from "../../scripts/relay-warmup.ts";

// A single-relay devnet: one proposer (beacon-1 + validator-1) and one builder
// (rbuilder-1) on the proposer's EL (el-1, always at head), bidding into
// mev-boost-relay-1 only — plus the relay's postgres/redis/housekeeper and
// observability. mev-boost-relay uses el-1 as its blocksim, so there's no second
// beacon; beacon-1 runs solo. Run this and the helix sibling and compare; see
// recipes/relay-bench.ts.

const MEV_BOOST_RELAY_PUBKEY =
  "0xa1885d66bef164889a2e35845c3b626545d7b0e513efe335e97c3a45e534013fa3bc38c3b7e6143695aecc4872ac52c4";

// mev-boost-relay optimistic mode is enabled at runtime (the bench POSTs builder
// status + collateral to its --internal-api), so the recipe is identical for
// both modes; the `optimistic` param is accepted only to match the helix factory
// signature. prometheus scrapes the relay's own /metrics (port 9062) on top of
// the rbuilder/mev-boost cross-checks.
export function mevBoostRelayRecipe(_opts: { optimistic?: boolean } = {}): Recipe {
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
          { name: "rbuilder-1", prototype: "rbuilder", refs: { el: "el-1", beacon: "beacon-1", relay: "mev-boost-relay-1" } },
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
            refs: { beacon: "beacon-1", postgres: "pg-mb-1", redis: "redis-mb-1", el: "el-1" },
          },
        ],
      },
      {
        name: "prometheus-1",
        containers: [{
          name: "prometheus-1",
          prototype: "prometheus",
          config: {
            scrape: [
              { job: "mev-boost-relay", ref: "mev-boost-relay-1", port: "http", path: "/metrics" },
              { job: "rbuilder-1", ref: "rbuilder-1", port: "full_telemetry", path: "/debug/metrics/prometheus" },
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
