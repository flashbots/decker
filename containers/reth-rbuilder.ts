import type { BinaryBuildSpec, HostCtx, Ports, ProcessDef, ProcessResult } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { binaryBuildPath } from "../utils/binary-build.ts";
import { rbuilderConfigFor } from "./rbuilder.ts";

// reth + rbuilder as a single host binary: vanilla reth runs as the node with
// rbuilder spawned in-process (`reth-rbuilder node --rbuilder.config <toml>`).
// Built from the rbuilder reth 2.2 migration fork — decker clones and compiles
// it on first `up`, then caches the binary (see utils/binary-build.ts). Override
// with `binary: "/path/to/reth-rbuilder"` on the process to skip the build.
const BUILD: BinaryBuildSpec = {
  repo: "https://github.com/faheelsattar/rbuilder",
  ref: "faheel/reth-2.2-migration",
  // CMAKE_POLICY_VERSION_MINIMUM=3.5: a transitive C dep (runng-sys → nng) pins
  // an ancient cmake_minimum_required that CMake >= 4 rejects; this lets it
  // configure anyway. Harmless on older CMake (honored since 3.31).
  cmd: "CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo build --release --bin reth-rbuilder",
  artifact: "target/release/reth-rbuilder",
};

const DEFAULT_HTTP_PORT = 8745;

export const ports: Ports = {
  // reth node
  rpc: 8545,
  authrpc: 8551,
  metrics: 9090,
  // rbuilder (telemetry servers: redacted = http+1, full = http+2)
  http:               { port: DEFAULT_HTTP_PORT,     protocol: "TCP", service: false },
  redacted_telemetry: { port: DEFAULT_HTTP_PORT + 1, protocol: "TCP", service: false },
  full_telemetry:     { port: DEFAULT_HTTP_PORT + 2, protocol: "TCP", service: false },
};

function refs(def: ProcessDef) {
  const beacon = def.refs?.beacon;
  const relay = def.refs?.relay;
  if (!beacon) throw new Error(`reth-rbuilder ${def.name}: missing refs.beacon`);
  if (!relay) throw new Error(`reth-rbuilder ${def.name}: missing refs.relay`);
  return { beacon, relay };
}

export function buildProcess(def: ProcessDef, ctx: HostCtx): ProcessResult {
  const { beacon, relay } = refs(def);
  const ps: Ports = { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
  const dataDir = ctx.dataPath(def.name, "data");
  const ipcPath = `${dataDir}/reth.ipc`;

  // rbuilder runs in-process, so it reads reth's state from the same datadir/IPC.
  const toml = rbuilderConfigFor(
    def.name,
    `${ctx.artifactsPath}/genesis.json`,
    dataDir,
    ipcPath,
    "0.0.0.0",
    ctx.url(beacon, "http"),
    relay,
    ctx.url(relay, "http"),
    portNum(ps.http),
  );
  const tomlPath = ctx.configPath(def.name, "rbuilder.toml");

  return {
    process: {
      command: [
        def.binary ?? binaryBuildPath(BUILD),
        "node",
        "--chain", `${ctx.artifactsPath}/genesis.json`,
        "--datadir", dataDir,
        "--color", "never",
        "--addr", "0.0.0.0",
        "--port", "30303",
        "--ipcpath", ipcPath,
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
        "--rbuilder.config", tomlPath,
      ],
    },
    configs: [{ filename: "rbuilder.toml", content: toml }],
    binaryBuild: def.binary ? undefined : BUILD,
  };
}
