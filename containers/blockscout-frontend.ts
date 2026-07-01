import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

const HTTP_PORT = 3002;
const NETWORK_ID = "1337";

export const ports: Ports = { http: HTTP_PORT };

// Surfaced in the `decker up` summary.
export const webui = { label: "Execution explorer (Blockscout)" };

// Blockscout's Next.js frontend (the user-facing UI). It runs its own server-side
// proxy to the backend (NEXT_PUBLIC_USE_NEXT_JS_PROXY), so the browser only ever
// talks to this origin — NEXT_PUBLIC_API_HOST is the *in-cluster* backend address,
// while NEXT_PUBLIC_APP_HOST/PORT and the RPC URL are browser-reachable (localhost).
// Refs: backend (the blockscout backend) and el (execution node, for the wallet RPC).
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const backend = def.refs?.backend;
  const el = def.refs?.el;
  if (!backend) throw new Error(`blockscout-frontend ${def.name}: missing refs.backend`);
  if (!el) throw new Error(`blockscout-frontend ${def.name}: missing refs.el`);

  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  const apiHost = new URL(ctx.url(backend, "http")).host; // server-side proxy target
  const elPort = new URL(ctx.url(el, "rpc")).port; // browser-side RPC

  return {
    container: {
      image: "ghcr.io/blockscout/frontend:latest",
      env: {
        HOSTNAME: "0.0.0.0",
        PORT: String(port),
        NEXT_PUBLIC_API_PROTOCOL: "http",
        NEXT_PUBLIC_API_WEBSOCKET_PROTOCOL: "ws",
        NEXT_PUBLIC_API_HOST: apiHost,
        NEXT_PUBLIC_USE_NEXT_JS_PROXY: "true",
        NEXT_PUBLIC_APP_PROTOCOL: "http",
        NEXT_PUBLIC_APP_HOST: "localhost",
        NEXT_PUBLIC_APP_PORT: String(port),
        NEXT_PUBLIC_NETWORK_NAME: "decker",
        NEXT_PUBLIC_NETWORK_ID: NETWORK_ID,
        NEXT_PUBLIC_NETWORK_RPC_URL: `http://localhost:${elPort}`,
        NEXT_PUBLIC_AD_BANNER_PROVIDER: "none",
        NEXT_PUBLIC_AD_TEXT_PROVIDER: "none",
        NEXT_PUBLIC_IS_TESTNET: "true",
        NEXT_PUBLIC_GAS_TRACKER_ENABLED: "true",
        NEXT_PUBLIC_HAS_BEACON_CHAIN: "true",
        NEXT_PUBLIC_NETWORK_VERIFICATION_TYPE: "validation",
      },
      ports: { http: port },
    },
  };
}
