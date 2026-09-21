// The rbuilder-operator config.toml the container writes, plus the devnet
// fixtures it needs. One template mirroring production's mustache file field
// for field, so a production change is a visible diff here.
import type { Ports } from "../../utils/types.ts";
import { portNum } from "../../utils/types.ts";
import { PRODUCTION_BUILDERS, builderBlock } from "./builders.ts";

// Devnet fixtures (NOT secrets): decker's prefunded anvil account #0 as the
// coinbase - shared with the gateway, which drops any block whose coinbase
// differs (see bidding-gateway.ts).
// Builder <-> gateway auth, as in production. A fixed devnet value; the
// gateway's builder_auth_tokens must list it.
export const DEVNET_BUILDER_AUTH_TOKEN = "decker-devnet-builder";

// A bidding gateway the builder ships blocks to: production runs TWO per
// builder - one collocated (loopback) and one remote - each a
// [[bidding_gateways]] entry with the same auth token and health polling.
export type GatewayEndpoint = { name: string; host: string; port: number; apiPort: number };

export const DEVNET_COINBASE_SECRET_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

type Opts = {
  name: string;
  clUrl: string;
  gateways: GatewayEndpoint[];
  ps: Ports;
  extraData: string;
};

// Mirrors production etc/rbuilder-operator/config.toml.mustache field for
// field, with devnet values where production has provisioned ones; the
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
priority_update_freshness_ms = 12000

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
${o.gateways.map(gatewayBlock).join("\n")}

${PRODUCTION_BUILDERS.map(builderBlock).join("\n")}`;

// One [[bidding_gateways]] entry, shaped like production: shared auth
// token, plaintext, health polling every 2s with a 1s probe timeout.
function gatewayBlock(g: GatewayEndpoint): string {
  return `[[bidding_gateways]]
name = "${g.name}"
auth_token = "${DEVNET_BUILDER_AUTH_TOKEN}"

[[bidding_gateways.endpoints]]
host = "${g.host}"
port = ${g.port}
use_tls = false
slot_info_url = "http://${g.host}:${g.apiPort}"
priority = 0
health_poll_interval_ms = 2000
health_probe_timeout_ms = 1000
health_failure_threshold = 2
`;
}

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
