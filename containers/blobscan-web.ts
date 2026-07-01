import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { pgUrl } from "./postgres.ts";

const HTTP_PORT = 3000;
const SECRET_KEY = "supersecure";

export const ports: Ports = { http: HTTP_PORT };

// Surfaced in the `decker up` summary.
export const webui = { label: "Blob explorer (Blobscan)" };

// Blobscan web UI. Reads from the same Postgres the API/indexer populate.
// Refs: postgres (database "blobscan").
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const postgres = def.refs?.postgres;
  if (!postgres) throw new Error(`blobscan-web ${def.name}: missing refs.postgres`);

  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  const dbUrl = pgUrl(ctx, postgres, "blobscan");

  return {
    container: {
      image: "docker.io/blossomlabs/blobscan-web:latest",
      env: {
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
        NEXT_PUBLIC_NETWORK_NAME: "devnet",
        SECRET_KEY,
        POSTGRES_STORAGE_ENABLED: "true",
        PORT: String(port),
      },
      ports: { http: port },
    },
  };
}
