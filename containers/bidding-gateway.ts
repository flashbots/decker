import type { ContainerDef, ContainerResult, Ctx, ImageBuildSpec, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { DEVNET_BUILDER_AUTH_TOKEN, DEVNET_COINBASE_SECRET_KEY, RBUILDER_PRISM_REF, RBUILDER_PRISM_REPO } from "./rbuilder-operator-reth.ts";
import { RELAY_BUILDER_PUBKEY } from "./rbuilder.ts";

// bidding-gateway: seals + submits the builder's blocks to relays and holds
// the relay (BLS) key - the production BuilderNet shape, where nodes ship
// blocks to remote gateways and the builder itself has no relay path. Same
// rbuilder-prism tag as the builder (shared ssz GatewayBlockData contract).
// Config mirrors rbuilder-prism's own e2e recipe
// (builder-playground/reth-rbuilder-gateway/gateway.toml).
export const IMAGE: ImageBuildSpec = {
  repo: RBUILDER_PRISM_REPO,
  ref: RBUILDER_PRISM_REF,
  name: "bidding-gateway",
  cmd: "$ENGINE build -f docker/Dockerfile.bidding-gateway --target bidding-gateway-runtime -t $IMAGE .",
};

export const ports: Ports = {
  // production `the collocated gateway`: 6072 block ingest,
  // 6073 gateway api (+ slot_info_url, /readyz), 6071 metrics
  blocks: 6072,
  api: 6073,
  metrics: 6071,
};

// Devnet BLS relay key (decker's default builder identity, containers/rbuilder.ts).
// anvil #0: the address of DEVNET_COINBASE_SECRET_KEY (builder coinbase, payout sender)
const DEVNET_COINBASE_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEVNET_RELAY_SECRET_KEY = "0x25295f0d1d592a90b333e26e85149708208e9f8e8bc18f6c77bd62f8ad7a6866";

export const gatewayConfigFor = (o: { name: string; relayName: string; relayUrl: string; ps: Ports; extraData: string }) => `\
instance_name = "${o.name}"

listen_addr = "0.0.0.0:${portNum(o.ps.blocks)}"
# builders authenticate with the shared token (production: BUILDER_AUTH_TOKEN)
builder_auth_tokens = ["${DEVNET_BUILDER_AUTH_TOKEN}"]
metrics_addr = "0.0.0.0:${portNum(o.ps.metrics)}"
gateway_api_addr = "0.0.0.0:${portNum(o.ps.api)}"

chain = "/artifacts/genesis.json"
genesis_fork_version = "0x20000089"

# shared with the builder: the gateway drops any block whose coinbase differs
coinbase_secret_key = "${DEVNET_COINBASE_SECRET_KEY}"
relay_secret_key = "${DEVNET_RELAY_SECRET_KEY}"

extra_data = "${o.extraData}"
error_storage_path = "/tmp/gateway-errors.sqlite"
log_level = "info,rbuilder=debug"
log_color = false
skip_relay_substrings = []

[[relays]]
name = "${o.relayName}"
url = "${o.relayUrl}"
priority = 0
use_ssz_for_submit = false
use_gzip_for_submit = false
mode = "full"

[bidding.bidding_cfg]
coinbase_payment_threshold_eth = "0.0001"

[bidding.bidding_prediction]
static_fallback_ms = -12000

[bidding.bidding_cfg.seal_instruction_manager_v3_cfg]
tbv_portion_share = 0.001
bid_jitter = true
max_tbv_portion_to_use_against_friends = 0.9
non_friend_reward_share = 0.5
max_tbv_to_use_friend_cap_eth = "1"

[bidding.best_competition_bid_selector_cfg]
excluded_relays_filters = []
our_builder_pubkeys = ["${RELAY_BUILDER_PUBKEY}"]
ignored_pubkeys = []
our_fee_recipients = ["${DEVNET_COINBASE_ADDRESS}"]
our_extra_datas = ["${o.extraData}"]
friend_builder_pubkeys = []
`;

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const relay = def.refs?.relay;
  if (!relay) throw new Error(`bidding-gateway ${def.name}: missing refs.relay`);
  const ps: Ports = { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
  const toml = gatewayConfigFor({
    name: def.name,
    relayName: relay,
    relayUrl: ctx.url(relay, "http"),
    ps,
    extraData: (def.config?.extraData as string | undefined) ?? "BuilderNet",
  });
  return {
    container: {
      image: IMAGE,
      args: ["--config", "/config/gateway.toml"],
      ports: ps,
      volumeMounts: [{ name: "artifacts", mountPath: "/artifacts", readOnly: true }],
    },
    volumes: [{ name: "artifacts", kind: "shared-readonly" }],
    configs: [{ filename: "gateway.toml", content: toml, mountPath: "/config/gateway.toml" }],
  };
}
