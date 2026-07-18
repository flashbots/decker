import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { BOOTNODE_ID } from "./bootnode.ts";

// op-rbuilder is the external L2 block builder (Flashbots' reth-based OP builder).
// rollup-boost asks it for a block each slot. It syncs the canonical chain from
// the sequencer EL over L2 P2P via the bootnode, then builds on the head. Reads
// the same l2-genesis + jwtsecret as the sequencer EL.
export const ports: Ports = {
  rpc: 9645,
  authrpc: 9651, // rollup-boost queries the engine API here
  metrics: { port: 6062, service: false },
  // p2p 30303 is container-internal.
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const ps = resolvedPorts(def);
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
        "--rollup.builder-secret-key", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        // Peer with the sequencer EL through the bootnode so it can sync the chain.
        "--bootnodes", `enode://${BOOTNODE_ID}@bootnode:30303`,
        "--nat", "none",
        "--rollup.discovery.v4",
      ],
      ports: ps,
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
