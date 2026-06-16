import type { Ports, Recipe } from "../../utils/types.ts";

// A single-relay devnet: one proposer (beacon-1 + validator-1) and one builder
// (rbuilder-1) on the proposer's EL (el-1, always at head), bidding into helix-1
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

export const recipe: Recipe = {
  artifacts: { generator: "l1", fork: "fulu" },
  pods: [
    {
      name: "el-1",
      shareProcessNamespace: true,
      containers: [
        { name: "el-1", prototype: "reth" },
        { name: "rbuilder-1", prototype: "rbuilder", refs: { el: "el-1", beacon: "beacon-1", relay: "helix-1" } },
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
        { name: "helix-1", prototype: "helix", refs: { beacon: "helix-beacon-1", sim: "helix-sim-1" } },
      ],
    },
    {
      name: "prometheus-1",
      containers: [{
        name: "prometheus-1",
        prototype: "prometheus",
        config: {
          scrape: [
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
