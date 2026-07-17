import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

// op-reth is the L2 execution engine for Karst and beyond: the Karst upgrade
// (OP Upgrade 19) ends op-geth support, so from Karst on the sequencer EL is
// op-reth. Drop-in replacement for the op-geth prototype — same port names, same
// artifacts (l2-genesis.json + jwtsecret), driven by op-node over the engine API
// (authrpc). Pinned to the OP Labs build the Karst notice requires (v2.3.3).
export const ports: Ports = {
  rpc: 9545,
  ws: 9546,
  authrpc: 9551,
  metrics: { port: 6061, service: false },
  // p2p 30303 is container-internal only (single sequencer, no discovery).
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const ps = resolvedPorts(def);
  return {
    container: {
      image: "us-docker.pkg.dev/oplabs-tools-artifacts/images/op-reth:v2.3.3",
      command: ["op-reth"],
      args: [
        "node",
        "--chain", "/artifacts/l2-genesis.json",
        "--datadir", "/data_op_reth",
        "--color", "never",
        "--addr", "0.0.0.0",
        "--port", "30303",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.port", String(portNum(ps.rpc)),
        // `miner` is required: op-batcher's DA-throttling loop calls
        // miner_setMaxDASize on the L2 EL and treats a missing method as fatal.
        "--http.api", "web3,eth,net,txpool,debug,trace,miner",
        "--http.corsdomain", "*",
        "--ws",
        "--ws.addr", "0.0.0.0",
        "--ws.port", String(portNum(ps.ws)),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.port", String(portNum(ps.authrpc)),
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--metrics", `0.0.0.0:${portNum(ps.metrics)}`,
        // Persist every block immediately — a dev chain has no reorg depth and
        // downstream RPC/archive queries expect block 0..head on disk at once
        // (same reason the L1 reth sets these; see containers/reth.ts).
        "--engine.persistence-threshold", "0",
        "--engine.memory-block-buffer-target", "0",
        "--disable-discovery",
      ],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_op_reth" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}
