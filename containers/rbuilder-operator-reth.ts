import type {
  ContainerDef,
  ContainerResult,
  Ctx,
  ImageBuildSpec,
  Ports,
} from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import {
  applyTomlOverrides,
  DEVNET_BUILDER_AUTH_TOKEN,
  DEVNET_COINBASE_SECRET_KEY,
  type GatewayEndpoint,
  operatorRethConfigFor,
} from "./rbuilder-operator-reth/config.ts";

// re-exported: recipes and the gateway container import these from the
// container module, not from its internals.
export {
  applyTomlOverrides,
  DEVNET_BUILDER_AUTH_TOKEN,
  DEVNET_COINBASE_SECRET_KEY,
  type GatewayEndpoint,
  operatorRethConfigFor,
};
export { PRODUCTION_BUILDERS } from "./rbuilder-operator-reth/builders.ts";

// rbuilder-operator-reth: the ONE binary a production BuilderNet node runs as
// its builder - rbuilder-operator supervising rbuilder with reth in-process.
// Pinned to the release production runs. Built exactly as rbuilder-prism's own
// e2e builds it (docker/Dockerfile.rbuilder, RBUILDER_BIN=rbuilder-operator-reth).
// Bump = change RBUILDER_PRISM_REF (a tag's commit, never a branch) here and in
// bidding-gateway.ts together: builder and gateway share the ssz
// GatewayBlockData contract and must come from one tag.
export const RBUILDER_PRISM_REPO =
  "https://github.com/flashbots/rbuilder-prism";
export const RBUILDER_PRISM_REF = "22aa1d5764076b21f86515f73a48a9978ffb1376";
// The release RBUILDER_PRISM_REF is the commit of. Bump both together.
export const RBUILDER_PRISM_VERSION = "v1.16.0";

export const IMAGE: ImageBuildSpec = {
  repo: RBUILDER_PRISM_REPO,
  ref: RBUILDER_PRISM_REF,
  name: "rbuilder-operator-reth",
  version: RBUILDER_PRISM_VERSION,
  dockerfile: "docker/Dockerfile.rbuilder",
  target: "rbuilder-runtime",
  buildArgs: { RBUILDER_BIN: "rbuilder-operator-reth" },
  // rbuilder-prism is private and pulls private cargo deps: the build needs a
  // GitHub token, exactly as rbuilder-prism's own release workflow passes one.
  secrets: ["gh_token"],
};

// Ports follow the production node (etc/rbuilder-operator/config.toml.mustache +
// etc/flowproxy/flowproxy.env.mustache): jsonrpc 8645 = orderflow ingress from
// flowproxy, redacted telemetry 6070 = flowproxy's readiness gate, full
// telemetry 6060, priority-update gRPC 8745; the reth side keeps its usual
// rpc/ws/authrpc/metrics. All in the Service: flowproxy and the CL dial them.
export const ports: Ports = {
  rpc: 8545,
  ws: 8546,
  authrpc: 8551,
  metrics: 9090,
  // k8s port names are DNS labels (<=15 chars, no underscores):
  // telemetry = full telemetry (prometheus at /debug/metrics/prometheus),
  // redacted = redacted telemetry (flowproxy's readiness gate),
  // priority = priority-update gRPC.
  jsonrpc: 8645,
  telemetry: 6060,
  redacted: 6070,
  priority: 8745,
};

function refs(def: ContainerDef) {
  const beacon = def.refs?.beacon;
  const gateway = def.refs?.gateway;
  // optional: a bidding-gateway container in the SAME pod, reached on loopback
  // the collocated gateway
  const localGateway = def.refs?.localGateway;
  if (!beacon) {
    throw new Error(`rbuilder-operator-reth ${def.name}: missing refs.beacon`);
  }
  if (!gateway) {
    throw new Error(`rbuilder-operator-reth ${def.name}: missing refs.gateway`);
  }
  return { beacon, gateway, localGateway };
}

// applyTomlOverrides: `config.rbuilderToml` = { key: rawTomlValue } replaces a
// top-level `key = ...` line of the generated config (or appends the key
// before the first table when absent). Values are raw TOML text, so
// `{ evm_caching_enable: "false", live_builders: '["mp-ordering-200ms"]' }`
// is exactly what lands. This is the ONE way a recipe/env deviates from the
// production-shaped config above - the deviation stays visible in the recipe
// options instead of forking the container.

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { beacon, gateway, localGateway } = refs(def);
  const ps: Ports = {
    ...ports,
    ...((def.config?.ports as Ports | undefined) ?? {}),
  };
  const gw = new URL(ctx.url(gateway, "blocks"));
  const gwApi = new URL(ctx.url(gateway, "api"));
  const gateways: GatewayEndpoint[] = [];
  if (localGateway) {
    // same pod -> loopback; the referenced container only supplies the ports
    gateways.push({
      name: "local",
      host: "127.0.0.1",
      port: Number(new URL(ctx.url(localGateway, "blocks")).port),
      apiPort: Number(new URL(ctx.url(localGateway, "api")).port),
    });
  }
  gateways.push({ name: "remote", host: gw.hostname, port: Number(gw.port), apiPort: Number(gwApi.port) });
  const toml = operatorRethConfigFor({
    name: def.name,
    clUrl: ctx.url(beacon, "http"),
    gateways,
    ps,
    extraData: (def.config?.extraData as string | undefined) ?? "BuilderNet",
  });
  const tomlFinal = applyTomlOverrides(
    toml,
    def.config?.rbuilderToml as Record<string, string> | undefined,
  );
  return {
    container: {
      image: IMAGE,
      // The playground recipe rbuilder-prism ships for exactly this binary
      // (builder-playground/reth-rbuilder-gateway/playground.yaml), pod-adapted.
      args: [
        "node",
        "--chain",
        "/artifacts/genesis.json",
        "--datadir",
        "/data_reth",
        "--color",
        "never",
        "--addr",
        "0.0.0.0",
        "--port",
        "30303",
        "--ipcpath",
        "/data_reth/reth.ipc",
        "--http",
        "--http.addr",
        "0.0.0.0",
        "--http.api",
        "admin,eth,web3,net,rpc,txpool",
        "--http.port",
        String(portNum(ps.rpc)),
        "--ws",
        "--ws.addr",
        "0.0.0.0",
        "--ws.port",
        String(portNum(ps.ws)),
        "--ws.api",
        "eth,web3,net,txpool,debug,trace",
        "--ws.origins",
        "*",
        "--authrpc.port",
        String(portNum(ps.authrpc)),
        "--authrpc.addr",
        "0.0.0.0",
        "--authrpc.jwtsecret",
        "/artifacts/jwtsecret",
        "--metrics",
        `0.0.0.0:${portNum(ps.metrics)}`,
        // NO --engine.persistence-threshold 0 / --engine.memory-block-buffer-target 0
        // here (reth.ts / reth-rbuilder.ts set them so an OUT-of-process rbuilder
        // sees fresh DB state): production's rbuilder-operator.service runs reth
        // defaults. (rbuilder-prism's own in-process playground does set them, so
        // this is parity, not a fix.)
        "--disable-discovery",
        "-vvv",
        "--rbuilder.config",
        "/config/rbuilder.toml",
      ],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data", mountPath: "/data_reth" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data", kind: "ephemeral" },
    ],
    configs: [{
      filename: "rbuilder.toml",
      content: tomlFinal,
      mountPath: "/config/rbuilder.toml",
    }],
  };
}
