import type { Recipe } from "../utils/types.ts";
import { recipe as rbuilder } from "./rbuilder.ts";

// The rbuilder devnet plus an observability stack: Prometheus scrapes reth,
// the relay, and rbuilder's full telemetry endpoint; Grafana visualizes it
// (with the image-renderer sidecar for panel PNGs); grafana-mcp exposes the
// whole thing to an agent over streamable-http at :8000/mcp.
export const recipe: Recipe = {
  ...rbuilder,
  pods: [
    ...rbuilder.pods,
    {
      name: "prometheus-1",
      containers: [
        {
          name: "prometheus-1",
          prototype: "prometheus",
          config: {
            scrape: [
              { job: "reth", ref: "el-1", port: "metrics" },
              { job: "relay", ref: "mev-boost-relay-1", port: "http" },
              {
                job: "rbuilder",
                ref: "rbuilder-1",
                port: "full_telemetry",
                path: "/debug/metrics/prometheus",
              },
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
    {
      name: "grafana-mcp-1",
      containers: [
        { name: "grafana-mcp-1", prototype: "grafana-mcp", refs: { grafana: "grafana-1" } },
      ],
    },
  ],
};
