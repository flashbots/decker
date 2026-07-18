import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

// rollup-boost sits between op-node and the L2 EL. Each block it asks the
// external builder (op-rbuilder) for a payload and falls back to the local EL
// (op-geth) if the builder is slow or errors. op-node drives *this* over the
// engine API instead of the EL directly.
// refs: l2 (the local/fallback EL), builder (op-rbuilder).
export const ports: Ports = {
  authrpc: 9751, // op-node's engine API target
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

function refs(def: ContainerDef) {
  const l2 = def.refs?.l2;
  const builder = def.refs?.builder;
  if (!l2) throw new Error(`rollup-boost ${def.name}: missing refs.l2`);
  if (!builder) throw new Error(`rollup-boost ${def.name}: missing refs.builder`);
  return { l2, builder };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { l2, builder } = refs(def);
  const ps = resolvedPorts(def);
  return {
    container: {
      image: "docker.io/flashbots/rollup-boost:v0.7.17",
      args: [
        "--rpc-host", "0.0.0.0",
        "--rpc-port", String(portNum(ps.authrpc)),
        "--l2-jwt-path", "/artifacts/jwtsecret",
        "--l2-url", ctx.url(l2, "authrpc"),
        "--builder-jwt-path", "/artifacts/jwtsecret",
        "--builder-url", ctx.url(builder, "authrpc"),
      ],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
    ],
  };
}
