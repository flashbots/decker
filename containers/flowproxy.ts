import { RBUILDER_PRISM_REF, RBUILDER_PRISM_REPO } from "./rbuilder-operator-reth.ts";
import type { ContainerDef, ContainerResult, Ctx, ImageBuildSpec, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { assetsVariant } from "../utils/image-build.ts";
import { DEPOSIT_CHAIN_ID } from "../generators/l1/constants.ts";

// flowproxy: BuilderNet's orderflow ingress. Everything a node receives
// enters here (users, and other nodes via the system listener), gets
// validated/rate-shaped and forwarded to the builder's jsonrpc. Pinned to
// what production runs: the production node image repo (,
// 2026-09-16) the downloader unit FLOWPROXY_REPO=the flowproxy repo
// FLOWPROXY_TAG=v2.13.0. Private repo: building needs a GitHub token
// (`--secret id=gh_token`, the Dockerfile's own contract; nothing is baked
// into the image).
// flowproxy moved into rbuilder-prism (crates/flowproxy, 2026-09-08); production's
// image still downloads the flowproxy repo v2.13.0 (the production node image repo
// 2026-09-16) but the source of truth is rbuilder-prism, so build it from the
// SAME repo/ref as the operator and the gateway.
export const FLOWPROXY_REPO = RBUILDER_PRISM_REPO;
export const FLOWPROXY_REF = RBUILDER_PRISM_REF;

// Locally modified build of the pinned ref - two upstream gaps, both with
// fixes proposed on rbuilder-prism (flowproxy/dockerfile-arch-agnostic,
// flowproxy/configurable-chain-id):
//   - docker/Dockerfile.flowproxy copies from x86_64 paths -> _assets/flowproxy.Dockerfile
//   - transactions are validated against a HARDCODED mainnet chain id ->
//     _assets/flowproxy-0001-configurable-chain-id.patch adds --chain-id/CHAIN_ID
// `variant` keeps this image's tag distinct from a pristine upstream build.
// GH_TOKEN must be in the environment (private repo + private cargo deps).
export const FLOWPROXY_ASSETS = ["flowproxy.Dockerfile", "flowproxy-0001-configurable-chain-id.patch"];

// Lazy: the variant hashes asset files, and module load must not touch the
// filesystem (every CLI command imports every container).
let cachedImage: ImageBuildSpec | undefined;
export function image(): ImageBuildSpec {
  cachedImage ??= {
    repo: FLOWPROXY_REPO,
    ref: FLOWPROXY_REF,
    name: "flowproxy",
    variant: assetsVariant(FLOWPROXY_ASSETS),
    cmd: '$ENGINE build --build-context src=. -f "$DECKER_ROOT/_assets/flowproxy.Dockerfile" --secret id=gh_token,env=GH_TOKEN -t $IMAGE "$DECKER_ROOT/_assets"',
  };
  return cachedImage;
}

// Production listens on loopback behind haproxy (user 5543 / system 5542,
// the production config repo the production config); here the same ports are the pod's,
// fronted by the haproxy container. metrics 8090 as in flowproxy.env.
export const ports: Ports = {
  user: 5543,
  system: 5542,
  metrics: 8090,
};

// Devnet orderflow signer (NOT a secret): anvil dev account #2. Production
// derives it from the config plane per node; a single-node devnet trusts itself.
const DEVNET_SIGNER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const DEVNET_SIGNER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const builder = def.refs?.builder;
  if (!builder) throw new Error(`flowproxy ${def.name}: missing refs.builder`);
  const ps: Ports = { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
  // Mirrors production etc/flowproxy/flowproxy.env.mustache key for key,
  // minus ClickHouse (no sink in a dev env) and the config plane (STATIC_PEERS is
  // the production alternative and a single node has no peers).
  const env: Record<string, string> = {
    BUILDERNET_NODE_NAME: def.name,
    BUILDER_REGION: (def.config?.region as string | undefined) ?? "us",
    // the devnet's chain id (flowproxy validates every tx against it;
    // upstream hardcodes mainnet - see the patch above)
    CHAIN_ID: String(DEPOSIT_CHAIN_ID),
    USER_LISTEN_ADDR: `0.0.0.0:${portNum(ps.user)}`,
    SYSTEM_LISTEN_ADDR: `0.0.0.0:${portNum(ps.system)}`,
    METRICS_ADDR: `0.0.0.0:${portNum(ps.metrics)}`,
    BUILDER_ENDPOINT: ctx.url(builder, "jsonrpc"),
    BUILDER_READY_ENDPOINT: ctx.url(builder, "redacted"),
    BUILDER_PRIORITY_UPDATE_GRPC_ENDPOINT: ctx.url(builder, "priority"),
    FLASHBOTS_ORDERFLOW_SIGNER: DEVNET_SIGNER_KEY,
    FLASHBOTS_ORDERFLOW_SIGNER_ADDRESS: DEVNET_SIGNER_ADDRESS,
    STATIC_PEERS: "/config/peers.json",
    API_KEYS_FILE: "/config/api-keys.toml",
    ORDERFLOW_FILTER_RULES_FILE: "/config/filter-rules.toml",
    MAX_BOB_STATE_FILTERS: "35",
    HIGH_PRIORITY_RECOVERY_IN_PLACE: "false",
    LOG_JSON: "false",
    RUST_LOG: "info",
  };
  return {
    container: {
      image: image(),
      env,
      ports: ps,
    },
    configs: [
      { filename: "peers.json", content: "[]\n", mountPath: "/config/peers.json" },
      { filename: "api-keys.toml", content: "api_keys = []\n", mountPath: "/config/api-keys.toml" },
      { filename: "filter-rules.toml", content: "rules = []\n", mountPath: "/config/filter-rules.toml" },
    ],
  };
}
