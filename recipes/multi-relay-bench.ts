import type { Recipe } from "../utils/types.ts";
import { recipe as multiRelay } from "./multi-relay.ts";
import { contenderCompare } from "../scripts/contender-compare.ts";

// multi-relay plus a Prometheus that scrapes only the two clients sandwiching
// each relay — the rbuilders (inbound: relay_submit_time, relay_accepted_submissions,
// relay_errors) and mev-boost (outbound: mev_boost_relay_latency,
// mev_boost_relay_status_code_total, mev_boost_bid_values). No relay-internal
// metrics: the clients are identical software for both relays, so their numbers
// are comparable; the relays' own /metrics are not.
//
// contender-compare.ts drives the windows; query these metrics over each
// window's [start, end] to get per-relay stats.
export const recipe: Recipe = {
  ...multiRelay,
  // relayWarmup (from multi-relay) runs first, then the benchmark.
  scripts: [...(multiRelay.scripts ?? []), contenderCompare()],
  pods: [
    ...multiRelay.pods,
    {
      name: "prometheus-1",
      containers: [
        {
          name: "prometheus-1",
          prototype: "prometheus",
          config: {
            scrape: [
              { job: "rbuilder-1", ref: "rbuilder-1", port: "full_telemetry", path: "/debug/metrics/prometheus" },
              { job: "rbuilder-2", ref: "rbuilder-2", port: "full_telemetry", path: "/debug/metrics/prometheus" },
              { job: "mev-boost", ref: "mev-boost-1", port: "metrics" },
            ],
          },
        },
      ],
    },
    {
      name: "grafana-renderer-1",
      containers: [
        { name: "grafana-renderer-1", prototype: "grafana-renderer" },
      ],
    },
    {
      name: "grafana-1",
      containers: [
        {
          name: "grafana-1",
          prototype: "grafana",
          refs: { prometheus: "prometheus-1", renderer: "grafana-renderer-1" },
        },
      ],
    },
  ],
};
