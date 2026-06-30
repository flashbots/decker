import type { ContainerDef, ContainerResult, Ctx, HostCtx, ProcessDef, ProcessResult } from "../utils/types.ts";

const DEFAULT_HTTP_PORT = 8745;
// Default builder relay-signing key. Multi-builder recipes override it per builder
// so each presents a DISTINCT pubkey to the relay (otherwise the relay treats them
// as one builder and the concurrency never materialises).
const DEFAULT_RELAY_SECRET_KEY = "0x25295f0d1d592a90b333e26e85149708208e9f8e8bc18f6c77bd62f8ad7a6866";

// Distinct builder identities for multi-builder runs. Builder 0 is the default key
// (so single-builder is unchanged); 1..3 are extra distinct BLS keys. `pubkey` is
// the G1 pubkey of `key` — the identity the relay sees on submitBlock, which relays
// mark optimistic. Derived once via @noble/curves bls12_381.getPublicKey(key).
export const BUILDER_KEYS: { key: string; pubkey: string }[] = [
  {
    key: DEFAULT_RELAY_SECRET_KEY,
    pubkey: "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
  },
  {
    key: "0x0000000000000000000000000000000000000000000000000000000000000a11",
    pubkey: "0x9301e3ba9d788f48717b9e6c5a6bfa411ac6402c1bd295cde1f9b15ed227fb0731972cddafad88ad6757e19a1dcd1e7e",
  },
  {
    key: "0x0000000000000000000000000000000000000000000000000000000000000b22",
    pubkey: "0xa56fd5565a1d956b0fed860ce50897a6d46c1d5ad1a0da46536b7e79859f389f301951be40fb3393f052c3f86aeb5b14",
  },
  {
    key: "0x0000000000000000000000000000000000000000000000000000000000000c33",
    pubkey: "0xa6c5f3747d81583ec22bca4cb33e72c89a15f58b77cc3f02f2993c4e88de8df583277958cb2f532badafa22fb08f6c65",
  },
];

// The single-builder default identity — what relays mark optimistic in the 1-builder
// recipes. Kept as a named export for existing call sites.
export const RELAY_BUILDER_PUBKEY = BUILDER_KEYS[0].pubkey;

export const ports = {
  http: { port: DEFAULT_HTTP_PORT, protocol: "TCP" as const, service: false },
  // Telemetry servers (see rbuilderConfigFor): redacted = http+1, full = http+2.
  // Declared so observability recipes can `ctx.url(..., "full_telemetry")`.
  redacted_telemetry: { port: DEFAULT_HTTP_PORT + 1, protocol: "TCP" as const, service: false },
  full_telemetry: { port: DEFAULT_HTTP_PORT + 2, protocol: "TCP" as const, service: false },
};

type RbuilderOpts = {
  name: string;
  chainPath: string;
  rethDatadir: string;
  rethIpcPath: string;
  bindIp: string;
  clUrl: string;
  relayName: string;
  relayUrl: string;
  httpPort: number;
  // ssz=true submits SSZ instead of JSON (the binary fast path both relays accept);
  // relaySecretKey sets this builder's identity (distinct per builder in multi-builder).
  // Both default (JSON / the default key) when omitted — e.g. the reth-rbuilder caller.
  ssz?: boolean;
  relaySecretKey?: string;
};

export const rbuilderConfigFor = (o: RbuilderOpts) => `\
log_json = false
log_level = "info,rbuilder=debug"
redacted_telemetry_server_port = ${o.httpPort + 1}
redacted_telemetry_server_ip = "${o.bindIp}"
full_telemetry_server_port = ${o.httpPort + 2}
full_telemetry_server_ip = "${o.bindIp}"

chain = "${o.chainPath}"
reth_datadir = "${o.rethDatadir}"
el_node_ipc_path = "${o.rethIpcPath}"

# First prefunded account (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
coinbase_secret_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
relay_secret_key = "${o.relaySecretKey ?? DEFAULT_RELAY_SECRET_KEY}"

cl_node_url = ["${o.clUrl}"]
genesis_fork_version = "0x20000089"
jsonrpc_server_port = ${o.httpPort}
jsonrpc_server_ip = "${o.bindIp}"
extra_data = "${o.name} ⚡"

ignore_cancellable_orders = true
root_hash_use_sparse_trie = true
root_hash_compare_sparse_trie = false
slot_delta_to_start_bidding_ms = -20000
live_builders = ["mp-ordering"]
enabled_relays = ["${o.relayName}"]

[[relays]]
name = "${o.relayName}"
url = "${o.relayUrl}"
use_ssz_for_submit = ${o.ssz ?? false}
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

// N builder containers for a relay recipe: each a distinct identity (BUILDER_KEYS[i])
// sharing el-1's reth, on its own jsonrpc/telemetry port block (8745, 8755, …). ssz
// toggles SSZ submission. Shared by the helix and mev-boost-relay recipes.
export function rbuilderContainers(relay: string, builders: number, ssz: boolean): ContainerDef[] {
  return Array.from({ length: builders }, (_, i) => ({
    name: `rbuilder-${i + 1}`,
    prototype: "rbuilder",
    refs: { el: "el-1", beacon: "beacon-1", relay },
    config: { port: 8745 + i * 10, relaySecretKey: BUILDER_KEYS[i].key, ssz },
  }));
}

function refs(def: { name: string; refs?: Record<string, string> }) {
  const el = def.refs?.el;
  const beacon = def.refs?.beacon;
  const relay = def.refs?.relay;
  if (!el) throw new Error(`rbuilder ${def.name}: missing refs.el`);
  if (!beacon) throw new Error(`rbuilder ${def.name}: missing refs.beacon`);
  if (!relay) throw new Error(`rbuilder ${def.name}: missing refs.relay`);
  return { el, beacon, relay };
}

function configOf(def: ContainerDef | ProcessDef) {
  return {
    httpPort: (def.config?.port as number | undefined) ?? DEFAULT_HTTP_PORT,
    ssz: (def.config?.ssz as boolean | undefined) ?? false,
    relaySecretKey: (def.config?.relaySecretKey as string | undefined) ?? DEFAULT_RELAY_SECRET_KEY,
  };
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const { beacon, relay } = refs(def);
  const { httpPort, ssz, relaySecretKey } = configOf(def);
  const toml = rbuilderConfigFor({
    name: def.name,
    chainPath: "/artifacts/genesis.json",
    rethDatadir: "/data_reth",
    rethIpcPath: "/data_reth/reth.ipc",
    bindIp: "0.0.0.0",
    clUrl: ctx.url(beacon, "http"),
    relayName: relay,
    relayUrl: ctx.url(relay, "http"),
    httpPort,
    ssz,
    relaySecretKey,
  });
  return {
    container: {
      image: "ghcr.io/flashbots/rbuilder:sha-0f2ea0c",
      args: ["run", "/config/rbuilder.toml"],
      ports: { http: { port: httpPort, protocol: "TCP" as const, service: false } },
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
  const { httpPort, ssz, relaySecretKey } = configOf(def);
  const rethDatadir = ctx.dataPath(el, "data");
  const toml = rbuilderConfigFor({
    name: def.name,
    chainPath: `${ctx.artifactsPath}/genesis.json`,
    rethDatadir,
    rethIpcPath: `${rethDatadir}/reth.ipc`,
    bindIp: "0.0.0.0",
    clUrl: ctx.url(beacon, "http"),
    relayName: relay,
    relayUrl: ctx.url(relay, "http"),
    httpPort,
    ssz,
    relaySecretKey,
  });
  const tomlPath = ctx.configPath(def.name, "rbuilder.toml");
  return {
    process: { command: [ctx.binary(def, "rbuilder"), "run", tomlPath] },
    configs: [{ filename: "rbuilder.toml", content: toml }],
  };
}
