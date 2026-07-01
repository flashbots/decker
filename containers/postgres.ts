import type { ContainerDef, ContainerResult, Ctx } from "../utils/types.ts";

// Generic Postgres, used by the explorers (Blockscout, Blobscan). `config`:
//   database — created on first boot via POSTGRES_DB (so apps that only run
//              `migrate deploy` find the DB already there)
//   password — defaults to the repo-wide "decker"
//   user     — defaults to "postgres"
//   ports.postgres — host/container port (must be unique across the recipe)
const DEFAULT_PORT = 5432;

export const PG_USER = "postgres";
export const PG_PASSWORD = "decker";

export const ports = {
  postgres: DEFAULT_PORT,
};

// Build a postgres:// connection string for a consumer referencing `ref`. Host
// is resolved through ctx (pod DNS), credentials follow the constants above.
export function pgUrl(ctx: Ctx, ref: string, database: string): string {
  const host = new URL(ctx.url(ref, "postgres")).host;
  return `postgresql://${PG_USER}:${PG_PASSWORD}@${host}/${database}`;
}

export function buildContainer(def: ContainerDef): ContainerResult {
  const portsCfg = def.config?.ports as { postgres?: number } | undefined;
  const port = portsCfg?.postgres ?? DEFAULT_PORT;
  const password = (def.config?.password as string | undefined) ?? PG_PASSWORD;
  const user = (def.config?.user as string | undefined) ?? PG_USER;
  const database = def.config?.database as string | undefined;

  const env: Record<string, string> = {
    POSTGRES_PASSWORD: password,
    PGDATA: "/var/lib/postgresql/data/pgdata",
  };
  if (user !== PG_USER) env.POSTGRES_USER = user;
  if (database) env.POSTGRES_DB = database;

  return {
    container: {
      image: "docker.io/postgres:17-alpine",
      args: ["postgres", "-p", String(port)],
      env,
      ports: { postgres: port },
      volumeMounts: [{ name: "pgdata", mountPath: "/var/lib/postgresql/data" }],
    },
    volumes: [{ name: "pgdata", kind: "ephemeral" }],
  };
}
