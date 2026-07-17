import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { pgUrl } from "./postgres.ts";

const HTTP_PORT = 4000;

export const ports: Ports = { http: HTTP_PORT };

// Blockscout backend (the API + indexer). Mirrors the Kurtosis ethereum-package
// config. Refs:
//   el       — execution node (needs trace/debug)
//   postgres — its own DB (database "blockscout")
//   verif    — the smart-contract verifier sidecar
// All three are reached server-side over pod DNS. The user-facing UI is the
// separate blockscout-frontend container.
//
// `config.variant` picks the JSON-RPC dialect for internal-tx tracing: "erigon"
// (default) for reth/op-reth (parity/erigon trace API), "geth" for op-geth
// (debug_trace*). Set it to match the referenced EL.
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const el = def.refs?.el;
  const postgres = def.refs?.postgres;
  const verif = def.refs?.verif;
  if (!el) throw new Error(`blockscout ${def.name}: missing refs.el`);
  if (!postgres) throw new Error(`blockscout ${def.name}: missing refs.postgres`);
  if (!verif) throw new Error(`blockscout ${def.name}: missing refs.verif`);

  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);
  const variant = (def.config?.variant as string | undefined) ?? "erigon";
  const elRpc = `${ctx.url(el, "rpc")}/`;

  return {
    container: {
      image: "ghcr.io/blockscout/blockscout:latest",
      command: [
        "/bin/sh",
        "-c",
        'bin/blockscout eval "Elixir.Explorer.ReleaseTasks.create_and_migrate()" && bin/blockscout start',
      ],
      env: {
        ETHEREUM_JSONRPC_VARIANT: variant,
        ETHEREUM_JSONRPC_HTTP_URL: elRpc,
        ETHEREUM_JSONRPC_TRACE_URL: elRpc,
        DATABASE_URL: pgUrl(ctx, postgres, "blockscout"),
        COIN: "ETH",
        MICROSERVICE_SC_VERIFIER_ENABLED: "true",
        MICROSERVICE_SC_VERIFIER_URL: `${ctx.url(verif, "http")}/`,
        MICROSERVICE_SC_VERIFIER_TYPE: "sc_verifier",
        INDEXER_DISABLE_PENDING_TRANSACTIONS_FETCHER: "true",
        ECTO_USE_SSL: "false",
        NETWORK: "decker",
        SUBNETWORK: "decker",
        PORT: String(port),
        SECRET_KEY_BASE: "56NtB48ear7+wMSf0IQuWDAAazhpb31qyc7GiyspBP2vh7t5zlCsF5QDv76chXeN",
      },
      ports: { http: port },
    },
  };
}
