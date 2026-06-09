import type { ContainerDef, ContainerResult, Ctx, HostCtx, Ports, ProcessDef, ProcessResult } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

export const ports: Ports = {
  rpc: 8545,
  authrpc: 8551,
  metrics: 9090,
};

function resolvedPorts(def: ContainerDef | ProcessDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const ps = resolvedPorts(def);
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
        "--http.port", String(portNum(ps.rpc)),
        "--authrpc.port", String(portNum(ps.authrpc)),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--metrics", `0.0.0.0:${portNum(ps.metrics)}`,
        "--engine.persistence-threshold", "0",
        "--engine.memory-block-buffer-target", "0",
        "-vvv",
        "--disable-discovery",
      ],
      ports: ps,
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
  const ps = resolvedPorts(def);
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
        "--http.port", String(portNum(ps.rpc)),
        "--authrpc.port", String(portNum(ps.authrpc)),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", `${ctx.artifactsPath}/jwtsecret`,
        "--metrics", `0.0.0.0:${portNum(ps.metrics)}`,
        "--engine.persistence-threshold", "0",
        "--engine.memory-block-buffer-target", "0",
        "-vvv",
        "--disable-discovery",
      ],
    },
  };
}
