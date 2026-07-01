import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { pgUrl } from "./postgres.ts";

const HTTP_PORT = 3001;
// Blobscan's getChain() only knows mainnet(1)/gnosis(100)/sepolia(11155111)/
// hoodi(560048) and throws "Unsupported chain" at boot for anything else — so a
// devnet must masquerade as one of those. Default to mainnet; the recipe sets
// `config.chainId` to whichever supported chain best matches its fork schedule.
const DEFAULT_CHAIN_ID = "1";
const SECRET_KEY = "supersecure";

export const ports: Ports = { http: HTTP_PORT };

// Blobscan API — the backend the indexer writes to and the web UI reads from.
// Refs: postgres (database "blobscan") and redis. Both reached over pod DNS.
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const postgres = def.refs?.postgres;
  const redis = def.refs?.redis;
  if (!postgres) throw new Error(`blobscan-api ${def.name}: missing refs.postgres`);
  if (!redis) throw new Error(`blobscan-api ${def.name}: missing refs.redis`);

  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  const chainId = String(def.config?.chainId ?? DEFAULT_CHAIN_ID);
  const dbUrl = pgUrl(ctx, postgres, "blobscan");
  const redisUri = `redis://${new URL(ctx.url(redis, "redis")).host}`;

  return {
    container: {
      image: "docker.io/blossomlabs/blobscan-api:latest",
      env: {
        CHAIN_ID: chainId,
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
        REDIS_URI: redisUri,
        SECRET_KEY,
        BLOBSCAN_API_PORT: String(port),
        POSTGRES_STORAGE_ENABLED: "true",
        NETWORK_NAME: "devnet",
      },
      ports: { http: port },
    },
  };
}
