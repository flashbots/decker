import type { Ports, Recipe } from "../../utils/types.ts";
import { BUILDER_KEYS, rbuilderContainers } from "../../containers/rbuilder.ts";

// A single-relay devnet: one proposer (beacon-1 + validator-1) and N builders
// (rbuilder-1..N) on the proposer's EL (el-1, always at head), bidding into helix-1
// only — plus helix's own sim stack and observability. Run this and the
// mev-boost-relay sibling and compare; see recipes/relay-bench.ts.

const HELIX_RELAY_PUBKEY =
  "0xb34cde46f57a246f10dd73ed8714c665dc187b2888353f0b8676c8790e1599de0e96e2a7d515db99126f8d62b7d44ca1";

// helix-beacon-1's p2p/http ports are shifted off beacon-1's defaults so they
// don't collide on the host.
const helixBeaconPorts: Ports = {
  http: 13500,
  "p2p-tcp": { port: 19000, protocol: "TCP", service: false },
  "p2p-udp": { port: 19000, protocol: "UDP", service: false },
  quic:      { port: 19100, protocol: "UDP", service: false },
};

// optimistic marks the builders optimistic on helix (fast path: accept before sim).
// ssz makes the builders submit SSZ instead of JSON. builders = how many distinct
// builders submit concurrently. header_delay is forced off so getHeader measures
// raw serve latency (a bench normalization).
export function helixRecipe(
  opts: {
    optimistic?: boolean;
    ssz?: boolean;
    builders?: number;
    realSim?: boolean;
    // Extra builder pubkeys to allow-list beyond BUILDER_KEYS (e.g. relay-bench's
    // concurrent flood pool) — helix requires static pre-registration, unlike
    // mev-boost-relay which auto-learns a builder on its first submission.
    extraBuilderPubkeys?: string[];
  } = {},
): Recipe {
  const builders = opts.builders ?? 1;
  // realSim (default true) validates via helix-sim-1 (the real gattaca reth fork) — required
  // for synchronous mode. realSim:false uses the always-valid mock-simulator (spammer only).
  const realSim = opts.realSim ?? true;
  return {
    artifacts: { generator: "l1", fork: "fulu" },
    pods: [
      {
        name: "el-1",
        shareProcessNamespace: true,
        containers: [
          { name: "el-1", prototype: "reth" },
          ...rbuilderContainers("helix-1", builders, opts.ssz ?? false),
        ],
      },
      {
        name: "beacon-1",
        containers: [
          {
            name: "beacon-1",
            prototype: "lighthouse-beacon",
            refs: { el: "el-1", builder: "mev-boost-1" },
            config: { peers: ["helix-beacon-1"] },
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
            config: { relays: [{ name: "helix-1", pubkey: HELIX_RELAY_PUBKEY }] },
          },
        ],
      },
      {
        name: "helix-sim-1",
        containers: [{ name: "helix-sim-1", prototype: "helix-simulator" }],
      },
      {
        name: "helix-beacon-1",
        containers: [
          {
            name: "helix-beacon-1",
            prototype: "lighthouse-beacon",
            refs: { el: "helix-sim-1" },
            config: { ports: helixBeaconPorts, peers: ["beacon-1"] },
          },
        ],
      },
      {
        name: "helix-1",
        containers: [
          { name: "postgres-1", prototype: "helix-postgres" },
          {
            name: "helix-1",
            prototype: "helix",
            // sim = helix-sim-1 (the real gattaca reth-fork validator) so sim does real work;
            // with optimistic=false helix waits on it before responding (synchronous mode).
            refs: { beacon: "helix-beacon-1", sim: realSim ? "helix-sim-1" : "mock-sim-1" },
            config: {
              optimistic: opts.optimistic ?? false,
              headerDelay: false,
              // Always configure at least one builder pubkey (the synthetic spammer's),
              // even at builders:0 where no rbuilder container runs — otherwise helix
              // wouldn't know the spammer's builder and couldn't process it optimistically.
              builderPubkeys: [
                ...BUILDER_KEYS.slice(0, Math.max(builders, 1)).map((b) => b.pubkey),
                ...(opts.extraBuilderPubkeys ?? []),
              ],
            },
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
              { job: "helix", ref: "helix-1", port: "metrics" },
              ...(builders > 0
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

export const recipe = helixRecipe();
