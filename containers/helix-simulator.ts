import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

const DEFAULT_RPC_PORT = 8555;
const DEFAULT_AUTHRPC_PORT = 18551;
const DEFAULT_RELAY_KEY = "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11";

export const ports: Ports = {
  rpc: DEFAULT_RPC_PORT,
  authrpc: DEFAULT_AUTHRPC_PORT,
};

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const rpcPort = (def.config?.rpcPort as number | undefined) ?? DEFAULT_RPC_PORT;
  const authrpcPort = (def.config?.authrpcPort as number | undefined) ?? DEFAULT_AUTHRPC_PORT;
  const relayKey = (def.config?.relayKey as string | undefined) ?? DEFAULT_RELAY_KEY;
  return {
    container: {
      image: "ghcr.io/gattaca-com/helix-simulator:main",
      env: { RELAY_KEY: relayKey },
      args: [
        "node",
        "--chain", "/artifacts/genesis.json",
        "--datadir", "/data_sim",
        "--color", "never",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.api", "all",
        "--http.port", String(rpcPort),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.port", String(authrpcPort),
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--disable-discovery",
        "--enable-ext",
        "--builder-collateral-map-path", "/config/collateral.json",
        "--relay-fee-recipient", "0x0000000000000000000000000000000000000000",
        "--multisend-contract", "0x0000000000000000000000000000000000000000",
      ],
      ports: { rpc: rpcPort, authrpc: authrpcPort },
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "sim-data",  mountPath: "/data_sim" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "sim-data",  kind: "ephemeral" },
    ],
    configs: [
      { filename: "collateral.json", content: "{}\n", mountPath: "/config/collateral.json" },
    ],
  };
}
