import type { ContainerDef, ContainerResult, Ctx } from "../utils/types.ts";

// contender is a load generator — a client that drives traffic at an RPC.
// It serves nothing itself, so it declares no ports.
export const ports = {};

const DEFAULT_IMAGE = "ghcr.io/flashbots/contender:latest";

// config:
//   rpcUrl   (required) where to send traffic, e.g. http://host.containers.internal:8745
//   image    override the contender image
//   scenario path to a scenario/testfile inside the container
//   duration run length (seconds)
//   args     full arg override — set this once you've pinned contender's CLI
export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const cfg = def.config ?? {};
  const rpcUrl = cfg.rpcUrl as string | undefined;
  if (!rpcUrl) throw new Error(`contender ${def.name}: config.rpcUrl is required`);

  const image = (cfg.image as string | undefined) ?? DEFAULT_IMAGE;

  // contender's exact flags vary by version; this default is a plain spam run.
  // Override wholesale via config.args once confirmed against your image.
  const args = (cfg.args as string[] | undefined) ?? [
    "spam",
    "-r", rpcUrl,
    ...(cfg.scenario ? ["-f", String(cfg.scenario)] : []),
    ...(cfg.duration ? ["-d", String(cfg.duration)] : []),
  ];

  return { container: { image, args, ports } };
}
