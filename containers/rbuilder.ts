import type { ContainerDef, ContainerResult, Ctx, HostCtx, ProcessDef, ProcessResult } from "../utils/types.ts";

export const ports = {
  http: 8745,
};

const rbuilderConfigFor = (
  name: string,
  chainPath: string,
  rethDatadir: string,
  rethIpcPath: string,
  bindIp: string,
  clUrl: string,
  relayUrl: string,
) => `\
log_json = false
log_level = "info,rbuilder=debug"
redacted_telemetry_server_port = 6061
redacted_telemetry_server_ip = "${bindIp}"
full_telemetry_server_port = 6060
full_telemetry_server_ip = "${bindIp}"

chain = "${chainPath}"
reth_datadir = "${rethDatadir}"
el_node_ipc_path = "${rethIpcPath}"

# First prefunded account (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
coinbase_secret_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
relay_secret_key = "0x25295f0d1d592a90b333e26e85149708208e9f8e8bc18f6c77bd62f8ad7a6866"

cl_node_url = ["${clUrl}"]
jsonrpc_server_port = ${ports.http}
jsonrpc_server_ip = "${bindIp}"
extra_data = "${name} ⚡"

ignore_cancellable_orders = true
root_hash_use_sparse_trie = true
root_hash_compare_sparse_trie = false
slot_delta_to_start_bidding_ms = -20000
live_builders = ["mp-ordering"]
enabled_relays = ["decker-mev-boost-relay"]

[[relays]]
name = "decker-mev-boost-relay"
url = "${relayUrl}"
use_ssz_for_submit = false
use_gzip_for_submit = false
mode = "full"

[[builders]]
name = "mp-ordering"
algo = "ordering-builder"
discard_txs = true
sorting = "max-profit"
failed_order_retries = 1
drop_failed_orders = true
`;

function refs(def: { name: string; refs?: Record<string, string> }) {
  const el = def.refs?.el;
  const beacon = def.refs?.beacon;
  const relay = def.refs?.relay;
  if (!el) throw new Error(`rbuilder ${def.name}: missing refs.el`);
  if (!beacon) throw new Error(`rbuilder ${def.name}: missing refs.beacon`);
  if (!relay) throw new Error(`rbuilder ${def.name}: missing refs.relay`);
  return { el, beacon, relay };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { beacon, relay } = refs(def);
  const toml = rbuilderConfigFor(
    def.name,
    "/artifacts/genesis.json",
    "/data_reth",
    "/data_reth/reth.ipc",
    "0.0.0.0",
    ctx.url(beacon, "http"),
    ctx.url(relay, "http"),
  );
  return {
    container: {
      image: "ghcr.io/flashbots/rbuilder:sha-7efdc0b",
      args: ["run", "/config/rbuilder.toml"],
      ports,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts",         readOnly: true },
        { name: "data",      mountPath: "/data_reth" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
    configs: [
      { filename: "rbuilder.toml", content: toml, mountPath: "/config/rbuilder.toml" },
    ],
  };
}

export function buildProcess(def: ProcessDef, ctx: HostCtx): ProcessResult {
  const { el, beacon, relay } = refs(def);
  const rethDatadir = ctx.dataPath(el, "data");
  const toml = rbuilderConfigFor(
    def.name,
    `${ctx.artifactsPath}/genesis.json`,
    rethDatadir,
    `${rethDatadir}/reth.ipc`,
    "0.0.0.0",
    ctx.url(beacon, "http"),
    ctx.url(relay, "http"),
  );
  const tomlPath = ctx.configPath(def.name, "rbuilder.toml");
  return {
    process: { command: [ctx.binary(def, "rbuilder"), "run", tomlPath] },
    configs: [{ filename: "rbuilder.toml", content: toml }],
  };
}
