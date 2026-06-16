import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

// Off Prometheus' default 9090 (reth's metrics port) and off 9091, which is
// commonly held by a host-side pushgateway/exporter. 9009 avoids both.
const HTTP_PORT = 9009;

export const ports: Ports = {
  http: HTTP_PORT,
};

// One scrape target. `ref`/`port` are resolved against the recipe at render
// time via ctx.url, so the recipe never hardcodes container hostnames.
type ScrapeEntry = {
  job: string;
  ref: string;
  port: string;
  path?: string;
  labels?: Record<string, string>;
};

function hostPort(ctx: Ctx, ref: string, port: string): string {
  return ctx.url(ref, port).replace(/^https?:\/\//, "");
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const scrape = (def.config?.scrape as ScrapeEntry[] | undefined) ?? [];
  const jobs = scrape.map((s) => {
    const target = hostPort(ctx, s.ref, s.port);
    const pathLine = s.path ? `\n    metrics_path: ${JSON.stringify(s.path)}` : "";
    const labelLines = s.labels
      ? "\n        labels:\n" +
        Object.entries(s.labels).map(([k, v]) => `          ${k}: ${JSON.stringify(v)}`).join("\n")
      : "";
    return `  - job_name: ${JSON.stringify(s.job)}${pathLine}
    static_configs:
      - targets: [${JSON.stringify(target)}]${labelLines}`;
  }).join("\n");

  const yml = `global:
  scrape_interval: 5s
  evaluation_interval: 5s
scrape_configs:
${jobs}
`;

  return {
    container: {
      image: "docker.io/prom/prometheus:v3.7.3",
      args: [
        "--config.file=/etc/prometheus/prometheus.yml",
        "--storage.tsdb.path=/prometheus",
        "--storage.tsdb.retention.time=24h",
        "--web.enable-lifecycle",
        `--web.listen-address=:${HTTP_PORT}`,
      ],
      ports,
    },
    configs: [
      { filename: "prometheus.yml", content: yml, mountPath: "/etc/prometheus/prometheus.yml" },
    ],
  };
}
