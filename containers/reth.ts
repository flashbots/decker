import type { ContainerDef, ContainerResult, Ctx, HostCtx, ProcessDef, ProcessResult } from "../utils/types.ts";

export const ports = {
  rpc: 8545,
  authrpc: 8551,
  metrics: 9090,
};

export function buildContainer(_def: ContainerDef, _ctx: Ctx): ContainerResult {
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

export function buildProcess(def: ProcessDef, ctx: HostCtx): ProcessResult {
  const dataDir = ctx.dataPath(def.name, "data");
  return {
    process: {
      command: [
        ctx.binary(def, "reth"),
        "node",
        "--chain", `${ctx.artifactsPath}/genesis.json`,
        "--datadir", dataDir,
        "--color", "never",
        "--addr", "0.0.0.0",
        "--port", "30303",
        "--ipcpath", `${dataDir}/reth.ipc`,
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.api", "admin,eth,web3,net,rpc,mev,flashbots",
        "--http.port", String(ports.rpc),
        "--authrpc.port", String(ports.authrpc),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", `${ctx.artifactsPath}/jwtsecret`,
        "--metrics", `0.0.0.0:${ports.metrics}`,
        "--engine.persistence-threshold", "0",
        "--engine.memory-block-buffer-target", "0",
        "-vvv",
        "--disable-discovery",
      ],
    },
  };
}
