import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

const SECRET_KEY = "supersecure";

// Headless — no ports, but every prototype must export `ports`.
export const ports: Ports = {};

// Blobscan indexer — reads the beacon + EL, writes blobs to the API. The 90s
// sleep (matching the Kurtosis package) lets the API finish its DB migrations
// before the indexer starts hitting it.
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  const el = def.refs?.el;
  const api = def.refs?.api;
  if (!beacon) throw new Error(`blobscan-indexer ${def.name}: missing refs.beacon`);
  if (!el) throw new Error(`blobscan-indexer ${def.name}: missing refs.el`);
  if (!api) throw new Error(`blobscan-indexer ${def.name}: missing refs.api`);

  return {
    container: {
      image: "docker.io/blossomlabs/blobscan-indexer:master",
      command: ["/bin/sh", "-c"],
      args: ["sleep 90 && /app/blob-indexer"],
      env: {
        BEACON_NODE_ENDPOINT: ctx.url(beacon, "http"),
        BLOBSCAN_API_ENDPOINT: ctx.url(api, "http"),
        EXECUTION_NODE_ENDPOINT: ctx.url(el, "rpc"),
        NETWORK_NAME: "devnet",
        SECRET_KEY,
      },
    },
  };
}
