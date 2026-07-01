import type { ContainerDef, ContainerResult } from "../utils/types.ts";

const DEFAULT_PORT = 6379;

export const ports = {
  redis: DEFAULT_PORT,
};

export function buildContainer(def: ContainerDef): ContainerResult {
  const portsCfg = def.config?.ports as { redis?: number } | undefined;
  const port = portsCfg?.redis ?? DEFAULT_PORT;
  return {
    container: {
      image: "docker.io/redis:7-alpine",
      ...(port !== DEFAULT_PORT ? { args: ["redis-server", "--port", String(port)] } : {}),
      ports: { redis: port },
    },
  };
}
