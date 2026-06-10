import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

const MCP_PORT = 8000;

export const ports: Ports = { mcp: MCP_PORT };

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const grafana = def.refs?.grafana;
  if (!grafana) throw new Error(`grafana-mcp ${def.name}: missing refs.grafana`);
  return {
    container: {
      // Go MCP server wrapping the Grafana API (query_prometheus,
      // list_dashboards, get_panel_image, …) over streamable-http at /mcp.
      // No token needed — grafana allows anonymous access on this network.
      image: "docker.io/grafana/mcp-grafana:0.14.0",
      env: { GRAFANA_URL: ctx.url(grafana, "http") },
      args: [
        "--transport", "streamable-http",
        "--address", `0.0.0.0:${MCP_PORT}`,
        "--endpoint-path", "/mcp",
        "--log-level", "warn",
      ],
      ports,
    },
  };
}
