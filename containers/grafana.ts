import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { RENDERER_TOKEN } from "./grafana-renderer.ts";

const HTTP_PORT = 3000;

export const ports: Ports = { http: HTTP_PORT };

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const prometheus = def.refs?.prometheus;
  const renderer = def.refs?.renderer;
  if (!prometheus) throw new Error(`grafana ${def.name}: missing refs.prometheus`);
  if (!renderer) throw new Error(`grafana ${def.name}: missing refs.renderer`);

  const datasource = `apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: ${ctx.url(prometheus, "http")}
    uid: prometheus
    isDefault: true
    editable: false
    jsonData:
      timeInterval: "5s"
      httpMethod: POST
`;

  // File-provisioned dashboards (vs API-created) so they render under the
  // anonymous Viewer role Grafana 13 allows.
  const dashboardProvider = `apiVersion: 1
providers:
  - name: decker
    orgId: 1
    type: file
    disableDeletion: false
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
`;

  const ds = { type: "prometheus", uid: "prometheus" };
  const dashboard = JSON.stringify({
    uid: "decker-rbuilder-obs",
    title: "decker rbuilder-obs",
    schemaVersion: 39,
    refresh: "5s",
    time: { from: "now-15m", to: "now" },
    panels: [
      {
        id: 1,
        type: "timeseries",
        title: "reth canonical chain height",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        datasource: ds,
        targets: [{ expr: "reth_blockchain_tree_canonical_chain_height", datasource: ds }],
      },
      {
        id: 2,
        type: "timeseries",
        title: "rbuilder coinbase balance",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        datasource: ds,
        targets: [{ expr: "rbuilder_coinbase_balance", datasource: ds }],
      },
      {
        id: 3,
        type: "stat",
        title: "scrape targets up",
        gridPos: { h: 6, w: 24, x: 0, y: 8 },
        datasource: ds,
        targets: [{ expr: "up", datasource: ds, legendFormat: "{{job}}" }],
      },
    ],
  });

  return {
    container: {
      image: "docker.io/grafana/grafana:13.0.1",
      env: {
        // Passwordless dev access. Grafana 13 allows only the Viewer role
        // for anonymous users — enough for query / list / get-panel-image
        // through the MCP. Host port is reachable only over Tailscale.
        GF_AUTH_ANONYMOUS_ENABLED: "true",
        GF_AUTH_DISABLE_LOGIN_FORM: "true",
        GF_AUTH_BASIC_ENABLED: "false",
        // Remote rendering via the image-renderer sidecar. Grafana 13 refuses
        // the default renderer token, so it must be set and match the
        // renderer's AUTH_TOKEN.
        GF_RENDERING_SERVER_URL: `${ctx.url(renderer, "http")}/render`,
        GF_RENDERING_CALLBACK_URL: `${ctx.url(def.name, "http")}/`,
        GF_RENDERING_RENDERER_TOKEN: RENDERER_TOKEN,
        GF_USERS_DEFAULT_THEME: "dark",
        GF_LOG_LEVEL: "warn",
      },
      ports,
    },
    configs: [
      {
        filename: "prometheus.yml",
        content: datasource,
        mountPath: "/etc/grafana/provisioning/datasources/prometheus.yml",
      },
      {
        filename: "dashboards.yml",
        content: dashboardProvider,
        mountPath: "/etc/grafana/provisioning/dashboards/decker.yml",
      },
      {
        filename: "rbuilder-obs.json",
        content: dashboard,
        mountPath: "/var/lib/grafana/dashboards/rbuilder-obs.json",
      },
    ],
  };
}
