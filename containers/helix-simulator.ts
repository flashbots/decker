import type { ContainerDef, ContainerResult, Ctx, ImageBuildSpec, Ports } from "../utils/types.ts";

const DEFAULT_RPC_PORT = 8555;
const DEFAULT_AUTHRPC_PORT = 18551;
const DEFAULT_RELAY_KEY = "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11";
// The path the disallow-list server serves under. Whatever container backs
// refs.blacklist owns this path, so it's config rather than an import — the
// provider may well live outside decker.
const DEFAULT_BLACKLIST_PATH = "/blacklist";
const DEFAULT_IMAGE = "ghcr.io/gattaca-com/helix-simulator:main";

export const ports: Ports = {
  rpc: DEFAULT_RPC_PORT,
  authrpc: DEFAULT_AUTHRPC_PORT,
};

// Either the published image (default), a pinned tag (config.image), or a build
// from a helix checkout (config.build = { repo, ref }) — the repo ships the
// simulator's own simulator.Dockerfile, so building it is just picking that file.
function image(def: ContainerDef): string | ImageBuildSpec {
  const build = def.config?.build as { repo: string; ref: string } | undefined;
  if (!build) return (def.config?.image as string | undefined) ?? DEFAULT_IMAGE;
  return { repo: build.repo, ref: build.ref, cmd: "$ENGINE build -t $IMAGE -f simulator.Dockerfile ." };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const rpcPort = (def.config?.rpcPort as number | undefined) ?? DEFAULT_RPC_PORT;
  const authrpcPort = (def.config?.authrpcPort as number | undefined) ?? DEFAULT_AUTHRPC_PORT;
  const relayKey = (def.config?.relayKey as string | undefined) ?? DEFAULT_RELAY_KEY;
  // The block-merging flags (collateral map, relay fee recipient, multisend) were
  // dropped from the simulator CLI in gattaca-com/helix#458; clap rejects unknown
  // args, so builds newer than that must pass mergingArgs: false.
  const mergingArgs = (def.config?.mergingArgs as boolean | undefined) ?? true;
  // Where the simulator polls its disallow list from. Without refs.blacklist it
  // keeps its built-in localhost default, which just fails every poll and leaves
  // the list empty (i.e. nothing is ever disallowed).
  const blacklist = def.refs?.blacklist;
  const blacklistPath = (def.config?.blacklistPath as string | undefined) ?? DEFAULT_BLACKLIST_PATH;
  return {
    container: {
      image: image(def),
      env: { RELAY_KEY: relayKey },
      args: [
        "node",
        "--chain", "/artifacts/genesis.json",
        "--datadir", "/data_sim",
        "--color", "never",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.api", "all",
        "--http.port", String(rpcPort),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.port", String(authrpcPort),
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--disable-discovery",
        "--enable-ext",
        ...(blacklist ? ["--blacklist-provider", `${ctx.url(blacklist, "http")}${blacklistPath}`] : []),
        ...(mergingArgs
          ? [
            "--builder-collateral-map-path", "/config/collateral.json",
            "--relay-fee-recipient", "0x0000000000000000000000000000000000000000",
            "--multisend-contract", "0x0000000000000000000000000000000000000000",
          ]
          : []),
      ],
      ports: { rpc: rpcPort, authrpc: authrpcPort },
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "sim-data",  mountPath: "/data_sim" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "sim-data",  kind: "ephemeral" },
    ],
    configs: mergingArgs
      ? [{ filename: "collateral.json", content: "{}\n", mountPath: "/config/collateral.json" }]
      : [],
  };
}
