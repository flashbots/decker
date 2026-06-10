import type { ContainerResult, Ports } from "../utils/types.ts";

// Shared with grafana.ts (GF_RENDERING_RENDERER_TOKEN). Not a secret — both
// sides live on the same private network, reachable only over Tailscale.
export const RENDERER_TOKEN = "decker-dev-renderer";

const HTTP_PORT = 8081;

export const ports: Ports = { http: HTTP_PORT };

export function buildContainer(): ContainerResult {
  return {
    container: {
      // v5+ is the Go rewrite — remote-service mode only, listens on :8081.
      // Old Node-era env (HTTP_PORT, ENABLE_METRICS) no longer applies.
      image: "docker.io/grafana/grafana-image-renderer:v5.8.3",
      env: {
        LOG_LEVEL: "warn",
        AUTH_TOKEN: RENDERER_TOKEN,
      },
      ports,
    },
  };
}
