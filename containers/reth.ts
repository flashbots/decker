import type { BuildResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {
  rpc: 8545,
  authrpc: 8551,
  metrics: 9090,
};

export function build(_def: ContainerDef, _ctx: Ctx): BuildResult {
  return {
    container: {
      image: "ghcr.io/paradigmxyz/reth:v1.9.3",
      command: ["/usr/local/bin/reth"],
      args: [
        "node",
        "--chain", "/artifacts/genesis.json",
        "--datadir", "/data_reth",
        "--color", "never",
        "--addr", "0.0.0.0",
        "--port", "30303",
        "--ipcpath", "/data_reth/reth.ipc",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.api", "admin,eth,web3,net,rpc,mev,flashbots",
        "--http.port", String(ports.rpc),
        "--authrpc.port", String(ports.authrpc),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--metrics", `0.0.0.0:${ports.metrics}`,
        "--engine.persistence-threshold", "0",
        "--engine.memory-block-buffer-target", "0",
        "-vvv",
        "--disable-discovery",
      ],
      ports,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_reth" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}
