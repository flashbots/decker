import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { BUILDER_ADDRESS, FLASHBLOCKS_WS_PORT } from "./op-rbuilder.ts";

// chain-monitor watches L1/L2 for stalled/missed blocks and builder wallet
export const ports: Ports = {
  http: 8087,
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

const DEFAULT_L2_BLOCK_TIME_SECONDS = 2;

function refs(def: ContainerDef) {
  const l1 = def.refs?.l1;
  const l2 = def.refs?.l2;
  if (!l1) throw new Error(`chain-monitor ${def.name}: missing refs.l1`);
  if (!l2) throw new Error(`chain-monitor ${def.name}: missing refs.l2`);
  return { l1, l2 };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { l1, l2 } = refs(def);
  const ps = resolvedPorts(def);
  const l2BlockTimeSeconds = (def.config?.l2BlockTimeSeconds as number | undefined) ?? DEFAULT_L2_BLOCK_TIME_SECONDS;
  const flashblocks = def.config?.flashblocks;
  const l2Rpc = ctx.url(l2, "rpc");

  return {
    container: {
      image: "ghcr.io/flashbots/chain-monitor:v0.0.58-dev.7",
      args: [
        "serve",
        "--server-listen-address", `0.0.0.0:${portNum(ps.http)}`,
        "--l1-rpc", ctx.url(l1, "rpc"),
        "--l2-rpc", l2Rpc,
        "--l2-block-time", `${l2BlockTimeSeconds}s`,
        "--l2-monitor-builder-address", BUILDER_ADDRESS,
        "--l2-monitor-wallet", `builder=${BUILDER_ADDRESS}`,
        // op-rbuilder's static port table has no "flashblocks" entry, reuse the
        // host resolved for --l2-rpc and pair it with the fixed ws port.
        ...(flashblocks
          ? ["--l2-monitor-flashblocks-private-stream", `builder=ws://${new URL(l2Rpc).hostname}:${FLASHBLOCKS_WS_PORT}`]
          : []),
      ],
      ports: ps,
      // chain-monitor has no startup retry
    },
  };
}
