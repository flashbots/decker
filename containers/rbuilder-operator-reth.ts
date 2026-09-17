import type {
  ContainerDef,
  ContainerResult,
  Ctx,
  ImageBuildSpec,
  Ports,
} from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

// rbuilder-operator-reth: the ONE binary a production BuilderNet node runs as
// its builder - rbuilder-operator supervising rbuilder with reth in-process.
// Pinned to what production runs: the production node image repo
//  the downloader unit
// RBUILDER_OPERATOR_RETH_TAG=v1.14.0. Built exactly as rbuilder-prism's own
// e2e builds it (docker/Dockerfile.rbuilder, RBUILDER_BIN=rbuilder-operator-reth).
// Bump = change RBUILDER_PRISM_REF (a tag's commit, never a branch) here and in
// bidding-gateway.ts together: builder and gateway share the ssz
// GatewayBlockData contract and must come from one tag.
export const RBUILDER_PRISM_REPO =
  "https://github.com/flashbots/rbuilder-prism";
export const RBUILDER_PRISM_REF = "8b21c4c64317abc6c64f74ee77d21672f2207a11"; // v1.14.0

export const IMAGE: ImageBuildSpec = {
  repo: RBUILDER_PRISM_REPO,
  ref: RBUILDER_PRISM_REF,
  name: "rbuilder-operator-reth",
  cmd:
    "$ENGINE build -f docker/Dockerfile.rbuilder --target rbuilder-runtime --build-arg RBUILDER_BIN=rbuilder-operator-reth -t $IMAGE .",
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

// Production's eight ordering builders, verbatim from the production config repo
// the production config builder_configs (2026-09-16).
export const PRODUCTION_BUILDERS = [
  { name: "mp-ordering-25ms", deadline: 25, sorting: "max-profit" },
  { name: "mgp-ordering-200ms", deadline: 200, sorting: "mev-gas-price" },
  {
    name: "mgp-ordering-45-5ms",
    deadline: 45,
    pre: 5,
    sorting: "mev-gas-price",
  },
  { name: "type-ordering-200ms", deadline: 200, sorting: "type-max-profit" },
  {
    name: "type-ordering-45-5ms",
    deadline: 45,
    pre: 5,
    sorting: "type-max-profit",
  },
  { name: "mp-ordering-200ms", deadline: 200, sorting: "max-profit" },
  { name: "mp-ordering-95-5ms", deadline: 95, pre: 5, sorting: "max-profit" },
  { name: "mp-ordering-45-5ms", deadline: 45, pre: 5, sorting: "max-profit" },
];

function builderBlock(
  b: { name: string; deadline: number; pre?: number; sorting: string },
): string {
  return `[[builders]]
name = "${b.name}"
algo = "ordering-builder"
build_duration_deadline_ms = ${b.deadline}
${
    b.pre !== undefined
      ? `pre_filtered_build_duration_deadline_ms = ${b.pre}\n`
      : ""
  }discard_txs = true
drop_failed_orders = true
failed_order_retries = 1
sorting = "${b.sorting}"
ignore_mempool_profit_on_bundles = true
bob_build_duration_deadline_ms = 10
`;
}

// Devnet fixtures (NOT secrets): decker's prefunded anvil account #0 as the
// coinbase - shared with the gateway, which drops any block whose coinbase
// differs (see bidding-gateway.ts).
export const DEVNET_COINBASE_SECRET_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

type Opts = {
  name: string;
  clUrl: string;
  gatewayHost: string;
  gatewayBlocksPort: number;
  gatewayApiPort: number;
  ps: Ports;
  extraData: string;
};

// Mirrors production etc/rbuilder-operator/config.toml.mustache field for
// field, with devnet values where production has the config plane values; the
// ClickHouse sections, blocklist and mainnet chain are the deliberate
// omissions (no CH sink in a dev env; blocklist would 404 the devnet).
export const operatorRethConfigFor = (o: Opts) =>
  `\
builder_name = "${o.name}"
chain = "/artifacts/genesis.json"
genesis_fork_version = "0x20000089"
cl_node_url = ["${o.clUrl}"]
coinbase_secret_key = "${DEVNET_COINBASE_SECRET_KEY}"

log_json = false
log_level = "info,rbuilder=debug"
error_storage_path = "/data_reth/rbuilder_errors.sqlite"

jsonrpc_server_ip = "0.0.0.0"
jsonrpc_server_port = ${portNum(o.ps.jsonrpc)}
full_telemetry_server_ip = "0.0.0.0"
full_telemetry_server_port = ${portNum(o.ps.telemetry)}
redacted_telemetry_server_ip = "0.0.0.0"
redacted_telemetry_server_port = ${portNum(o.ps.redacted)}
priority_update_grpc_server_ip = "0.0.0.0"
priority_update_grpc_server_port = ${portNum(o.ps.priority)}
priority_update_simulation_threads = 1
priority_update_takers_speed_bump_ms = 50

extra_data = "${o.extraData}"
evm_caching_enable = true
faster_finalize = true
ignore_blobs = false
ignore_cancellable_orders = false
max_bob_state_filters = 35
max_order_execution_duration_warning_us = 50000
require_non_empty_blocklist = false
root_hash_use_sparse_trie = true
root_hash_sparse_trie_version = "v2"
root_hash_threads = 4
simulation_threads = 8
time_to_keep_mempool_txs_secs = 600
watchdog_timeout_sec = 0

live_builders = [${PRODUCTION_BUILDERS.map((b) => `"${b.name}"`).join(", ")}]

# Built blocks go to the bidding gateway, which seals and submits to relays;
# the builder has no relay path (relays and bidding_gateways are mutually
# exclusive since operator v1.6.0).
[[bidding_gateways]]
name = "devnet"

[[bidding_gateways.endpoints]]
host = "${o.gatewayHost}"
port = ${o.gatewayBlocksPort}
slot_info_url = "http://${o.gatewayHost}:${o.gatewayApiPort}"

${PRODUCTION_BUILDERS.map(builderBlock).join("\n")}`;

function refs(def: ContainerDef) {
  const beacon = def.refs?.beacon;
  const gateway = def.refs?.gateway;
  if (!beacon) {
    throw new Error(`rbuilder-operator-reth ${def.name}: missing refs.beacon`);
  }
  if (!gateway) {
    throw new Error(`rbuilder-operator-reth ${def.name}: missing refs.gateway`);
  }
  return { beacon, gateway };
}

// applyTomlOverrides: `config.rbuilderToml` = { key: rawTomlValue } replaces a
// top-level `key = ...` line of the generated config (or appends the key
// before the first table when absent). Values are raw TOML text, so
// `{ evm_caching_enable: "false", live_builders: '["mp-ordering-200ms"]' }`
// is exactly what lands. This is the ONE way a recipe/env deviates from the
// production-shaped config above - the deviation stays visible in the recipe
// options instead of forking the container.
export function applyTomlOverrides(
  toml: string,
  over: Record<string, string> | undefined,
): string {
  if (!over || Object.keys(over).length === 0) return toml;
  const lines = toml.split("\n");
  const firstTable = lines.findIndex((l) => l.startsWith("["));
  const pending: string[] = [];
  for (const [k, v] of Object.entries(over)) {
    const idx = lines.findIndex((l, i) =>
      (firstTable < 0 || i < firstTable) && l.startsWith(`${k} =`)
    );
    if (idx >= 0) lines[idx] = `${k} = ${v}`;
    else pending.push(`${k} = ${v}`);
  }
  if (pending.length) {
    const at = firstTable < 0 ? lines.length : firstTable;
    lines.splice(at, 0, "# overrides (config.rbuilderToml)", ...pending, "");
  }
  return lines.join("\n");
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { beacon, gateway } = refs(def);
  const ps: Ports = {
    ...ports,
    ...((def.config?.ports as Ports | undefined) ?? {}),
  };
  const gw = new URL(ctx.url(gateway, "blocks"));
  const gwApi = new URL(ctx.url(gateway, "api"));
  const toml = operatorRethConfigFor({
    name: def.name,
    clUrl: ctx.url(beacon, "http"),
    gatewayHost: gw.hostname,
    gatewayBlocksPort: Number(gw.port),
    gatewayApiPort: Number(gwApi.port),
    ps,
    extraData: (def.config?.extraData as string | undefined) ??
      "BuilderNet devnet",
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
