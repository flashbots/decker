import type {
  BinaryBuildSpec,
  ContainerDef,
  ContainerResult,
  Ctx,
  HostCtx,
  Ports,
  ProcessDef,
  ProcessResult,
} from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { binaryBuildPath } from "../utils/binary-build.ts";
import { BOOTNODE_ID, EL_P2P_ID } from "./bootnode.ts";

// op-rbuilder is the external L2 block builder (Flashbots' reth-based OP builder).
// rollup-boost asks it for a block each slot. It syncs the canonical chain from
// the sequencer EL over L2 P2P via the bootnode, then builds on the head. Reads
// the same l2-genesis + jwtsecret as the sequencer EL.
//
// recipes/opstack.ts's `builderBinary` runs this as a HOST PROCESS instead
export const ports: Ports = {
  rpc: 9645,
  authrpc: 9651, // rollup-boost queries the engine API here
  metrics: { port: 6062, service: false },
  // p2p 30303 is container-internal.
};

function resolvedPorts(def: ContainerDef | ProcessDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

type FlashblocksConfig = {
  blockTimeMs?: number; // --flashblocks.block-time
  endBufferMs?: number; // --flashblocks.end-buffer-ms
  sendOffsetMs?: number; // --flashblocks.send-offset-ms (negative sends early)
  continuousBuild?: boolean; // --flashblocks.continuous-build
};

const FLASHBLOCKS_DEFAULTS: Required<FlashblocksConfig> = {
  blockTimeMs: 200,
  endBufferMs: 75,
  sendOffsetMs: -30,
  continuousBuild: true,
};

// op-rbuilder default for --flashblocks.port. Exported so chain-monitor.ts can
// reuse it (the static `ports` table above has no "flashblocks" entry).
export const FLASHBLOCKS_WS_PORT = 1111;

function flashblocksArgs(opt: boolean | FlashblocksConfig | undefined, wsPort: number): string[] {
  if (!opt) return [];
  const cfg = { ...FLASHBLOCKS_DEFAULTS, ...(typeof opt === "object" ? opt : {}) };
  return [
    "--flashblocks.addr", "0.0.0.0",
    "--flashblocks.port", String(wsPort),
    "--flashblocks.block-time", String(cfg.blockTimeMs),
    "--flashblocks.end-buffer-ms", String(cfg.endBufferMs),
    "--flashblocks.send-offset-ms", String(cfg.sendOffsetMs),
    ...(cfg.continuousBuild ? ["--flashblocks.continuous-build"] : []),
  ];
}

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const ps = resolvedPorts(def);
  const flashblocks = def.config?.flashblocks as boolean | FlashblocksConfig | undefined;
  const fbPort = portNum(ps.flashblocks ?? FLASHBLOCKS_WS_PORT);
  return {
    container: {
      image: "ghcr.io/flashbots/op-rbuilder:v0.4.9",
      // The image entrypoint is the op-rbuilder binary; args start at its subcommand.
      args: [
        "node",
        "--authrpc.port", String(portNum(ps.authrpc)),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.port", String(portNum(ps.rpc)),
        "--chain", "/artifacts/l2-genesis.json",
        "--datadir", "/data_op_rbuilder",
        "--color", "never",
        "--metrics", `0.0.0.0:${portNum(ps.metrics)}`,
        "--port", "30303",
        "--builder.enable-revert-protection",
        // Builder signing key (1st hardhat account).
        "--rollup.builder-secret-key", BUILDER_SECRET_KEY,
        // Peer with the sequencer EL through the bootnode so it can sync the chain.
        "--bootnodes", `enode://${BOOTNODE_ID}@bootnode:30303`,
        "--nat", "none",
        "--rollup.discovery.v4",
        ...flashblocksArgs(flashblocks, fbPort),
      ],
      ports: flashblocks ? { ...ps, flashblocks: ps.flashblocks ?? FLASHBLOCKS_WS_PORT } : ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_op_rbuilder" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}

// Build from source when no local binary is configured
const BUILD: BinaryBuildSpec = {
  repo: "https://github.com/flashbots/op-rbuilder.git",
  ref: "main",
  cmd: "cargo build --release --bin op-rbuilder",
  artifact: "target/release/op-rbuilder",
};

// op-rbuilder's own p2p listener when it runs as a host process. Distinct from
// the container-mode literal (30303) above: in this mode host port 30303 is
// already taken by the sequencer EL's published p2p port.
const PROCESS_P2P_PORT = 30313;

// Builder signing key (1st hardhat/anvil dev account)
export const BUILDER_SECRET_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const BUILDER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function refs(def: ProcessDef) {
  const l2 = def.refs?.l2;
  if (!l2) throw new Error(`op-rbuilder ${def.name}: missing refs.l2`);
  return { l2 };
}

export function buildProcess(def: ProcessDef, ctx: HostCtx): ProcessResult {
  const { l2 } = refs(def);
  const ps = resolvedPorts(def);
  const dataDir = ctx.dataPath(def.name, "data");
  // The sequencer EL only publishes its p2p port to the host in this mode.
  const elP2pPort = new URL(ctx.url(l2, "p2p")).port;
  const flashblocks = def.config?.flashblocks as boolean | FlashblocksConfig | undefined;
  const fbPort = portNum(ps.flashblocks ?? FLASHBLOCKS_WS_PORT);

  return {
    process: {
      command: [
        def.binary ?? binaryBuildPath(BUILD),
        "node",
        "--authrpc.port", String(portNum(ps.authrpc)),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.jwtsecret", `${ctx.artifactsPath}/jwtsecret`,
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.port", String(portNum(ps.rpc)),
        "--chain", `${ctx.artifactsPath}/l2-genesis.json`,
        "--datadir", dataDir,
        "--color", "never",
        "--metrics", `0.0.0.0:${portNum(ps.metrics)}`,
        "--port", String(PROCESS_P2P_PORT),
        "--builder.enable-revert-protection",
        // Builder signing key, same as container mode.
        "--rollup.builder-secret-key", BUILDER_SECRET_KEY,
        // Rootless podman pod IPs aren't reachable from the host and
        // discovery-advertised addresses are useless across that boundary, so
        // don't rely on discovery at all: dial  EL directly by its fixed enode
        "--trusted-peers", `enode://${EL_P2P_ID}@127.0.0.1:${elP2pPort}`,
        "--disable-discovery",
        ...flashblocksArgs(flashblocks, fbPort),
      ],
    },
    binaryBuild: def.binary ? undefined : BUILD,
  };
}
