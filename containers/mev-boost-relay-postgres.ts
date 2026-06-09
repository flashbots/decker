import type { ContainerDef, ContainerResult } from "../utils/types.ts";

const DEFAULT_PORT = 5432;
const DEFAULT_PASSWORD = "decker";

export const ports = {
  postgres: DEFAULT_PORT,
};

export function buildContainer(def: ContainerDef): ContainerResult {
  const portsCfg = def.config?.ports as { postgres?: number } | undefined;
  const port = portsCfg?.postgres ?? DEFAULT_PORT;
  const password = (def.config?.password as string | undefined) ?? DEFAULT_PASSWORD;
  return {
    container: {
      image: "docker.io/postgres:17-alpine",
      args: ["postgres", "-p", String(port)],
      env: {
        POSTGRES_PASSWORD: password,
        PGDATA: "/var/lib/postgresql/data/pgdata",
      },
      ports: { postgres: port },
      volumeMounts: [{ name: "pgdata", mountPath: "/var/lib/postgresql/data" }],
    },
    volumes: [{ name: "pgdata", kind: "ephemeral" }],
  };
}
