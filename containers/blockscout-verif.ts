import type { ContainerDef, ContainerResult, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

const HTTP_PORT = 8050;

export const ports: Ports = { http: HTTP_PORT };

// Blockscout's smart-contract verifier microservice. No refs — the backend
// points at it via MICROSERVICE_SC_VERIFIER_URL.
export function buildContainer(def: ContainerDef): ContainerResult {
  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  return {
    container: {
      image: "ghcr.io/blockscout/smart-contract-verifier:latest",
      env: {
        SMART_CONTRACT_VERIFIER__SERVER__HTTP__ADDR: `0.0.0.0:${port}`,
      },
      ports: { http: port },
    },
  };
}
