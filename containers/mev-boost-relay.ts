import type { ContainerResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {
  http: 5555,
};

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  if (!beacon) throw new Error(`mev-boost-relay ${def.name}: missing refs.beacon`);
  return {
    container: {
      image: "docker.io/flashbots/playground-utils:cc6f172493d7ef6b88a5b7895f4b8619806c99f9",
      command: ["mev-boost-relay"],
      args: [
        "--api-listen-addr", "0.0.0.0",
        "--api-listen-port", String(ports.http),
        "--beacon-client-addr", ctx.url(beacon, "http"),
      ],
      env: { ALLOW_SYNCING_BEACON_NODE: "1" },
      ports,
    },
  };
}
