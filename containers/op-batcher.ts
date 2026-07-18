import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

// op-batcher submits L2 batches back to L1 (calldata by default). refs: l1 (L1
// EL), l2 (op-geth), rollup (op-node). It's a pure client — no inbound ports,
// no artifacts; the batcher account is the 10th hardhat key (prefunded in both
// genesis allocs).
export const ports: Ports = {};

function refs(def: ContainerDef) {
  const l1 = def.refs?.l1;
  const l2 = def.refs?.l2;
  const rollup = def.refs?.rollup;
  if (!l1) throw new Error(`op-batcher ${def.name}: missing refs.l1`);
  if (!l2) throw new Error(`op-batcher ${def.name}: missing refs.l2`);
  if (!rollup) throw new Error(`op-batcher ${def.name}: missing refs.rollup`);
  return { l1, l2, rollup };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { l1, l2, rollup } = refs(def);
  return {
    container: {
      image: "us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher:v1.16.10",
      command: ["op-batcher"],
      args: [
        "--l1-eth-rpc", ctx.url(l1, "rpc"),
        "--l2-eth-rpc", ctx.url(l2, "rpc"),
        "--rollup-rpc", ctx.url(rollup, "rpc"),
        "--max-channel-duration=2",
        "--sub-safety-margin=4",
        "--poll-interval=1s",
        "--num-confirmations=1",
        "--private-key=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
      ],
    },
  };
}
