import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

// op-node is the L2 rollup node / sequencer driver. It reads the L1 chain
// (execution RPC + beacon) and drives op-geth over the engine API to build and
// sequence L2 blocks. refs: l1 (L1 EL), l1beacon (L1 CL), l2 (op-geth).
export const ports: Ports = {
  rpc: 9549,
  metrics: { port: 7300, service: false },
  // p2p 9003 is container-internal only (single sequencer).
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

function refs(def: ContainerDef) {
  const l1 = def.refs?.l1;
  const l1beacon = def.refs?.l1beacon;
  const l2 = def.refs?.l2;
  if (!l1) throw new Error(`op-node ${def.name}: missing refs.l1`);
  if (!l1beacon) throw new Error(`op-node ${def.name}: missing refs.l1beacon`);
  if (!l2) throw new Error(`op-node ${def.name}: missing refs.l2`);
  return { l1, l1beacon, l2 };
}

// op-node is generally backward-compatible across L2 forks, so the version is a
// config knob rather than a per-fork prototype. Karst requires v1.19.1; the
// isthmus/jovian recipes stay on the version they were verified with.
const DEFAULT_OP_NODE_TAG = "v1.16.3";

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { l1, l1beacon, l2 } = refs(def);
  const ps = resolvedPorts(def);
  const tag = (def.config?.tag as string | undefined) ?? DEFAULT_OP_NODE_TAG;

  return {
    container: {
      image: `us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:${tag}`,
      command: ["op-node"],
      args: [
        "--l1", ctx.url(l1, "rpc"),
        "--l1.beacon", ctx.url(l1beacon, "http"),
        "--l1.epoch-poll-interval", "12s",
        "--l1.http-poll-interval", "6s",
        "--l2", ctx.url(l2, "authrpc"),
        "--l2.jwt-secret", "/artifacts/jwtsecret",
        "--metrics.enabled",
        "--metrics.addr", "0.0.0.0",
        "--metrics.port", String(portNum(ps.metrics)),
        "--sequencer.enabled",
        "--sequencer.l1-confs", "0",
        "--verifier.l1-confs", "0",
        // Static sequencer signing key (5th hardhat account) — matches the value
        // baked into the L2 SystemConfig in the artifacts.
        "--p2p.sequencer.key", "8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
        "--rollup.config", "/artifacts/rollup.json",
        "--rollup.l1-chain-config", "/artifacts/genesis.json",
        "--rpc.addr", "0.0.0.0",
        "--rpc.port", String(portNum(ps.rpc)),
        "--p2p.listen.ip", "0.0.0.0",
        "--p2p.listen.tcp", "9003",
        "--p2p.listen.udp", "9003",
        "--p2p.scoring.peers", "light",
        "--p2p.ban.peers", "true",
        "--pprof.enabled",
        "--rpc.enable-admin",
        "--safedb.path", "/data_db",
      ],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_db" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}
