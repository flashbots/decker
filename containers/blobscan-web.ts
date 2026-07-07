import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { pgUrl } from "./postgres.ts";

const HTTP_PORT = 3000;
const SECRET_KEY = "supersecure";

export const ports: Ports = { http: HTTP_PORT };

// Surfaced in the `decker up` summary.
export const webui = { label: "Blob explorer (Blobscan)" };

// Blobscan web UI. Reads from the same Postgres the API/indexer populate.
// Refs: postgres (database "blobscan") and redis (without REDIS_URI the image
// falls back to localhost:6379 and error-spams when redis lives elsewhere).
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const postgres = def.refs?.postgres;
  const redis = def.refs?.redis;
  if (!postgres) throw new Error(`blobscan-web ${def.name}: missing refs.postgres`);
  if (!redis) throw new Error(`blobscan-web ${def.name}: missing refs.redis`);

  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  const dbUrl = pgUrl(ctx, postgres, "blobscan");
  const redisUri = `redis://${new URL(ctx.url(redis, "redis")).host}`;

  return {
    container: {
      image: "docker.io/blossomlabs/blobscan-web:latest",
      env: {
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
        REDIS_URI: redisUri,
        NEXT_PUBLIC_NETWORK_NAME: "devnet",
        SECRET_KEY,
        POSTGRES_STORAGE_ENABLED: "true",
        PORT: String(port),
      },
      ports: { http: port },
    },
  };
}
