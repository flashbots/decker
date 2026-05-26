import type { ContainerResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {
  ready: 21171,
};

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const target = def.refs?.target;
  if (!target) throw new Error(`healthmon ${def.name}: missing refs.target`);
  const mode = def.config?.mode as string | undefined;
  if (!mode) throw new Error(`healthmon ${def.name}: missing config.mode`);
  const targetPort = (def.config?.targetPort as string | undefined) ?? "http";
  return {
    container: {
      image: "docker.io/flashbots/playground-utils:cc6f172493d7ef6b88a5b7895f4b8619806c99f9",
      command: ["healthmon"],
      args: [
        "--chain", mode,
        "--url", ctx.url(target, targetPort),
      ],
      ports,
    },
  };
}
