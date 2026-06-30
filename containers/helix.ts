import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { RELAY_BUILDER_PUBKEY } from "./rbuilder.ts";

// Optimistic relaying is per-builder: the builder's pubkey must be present in
// `builders:` with is_optimistic + collateral ≥ bid value. 1e24 wei (1M ETH)
// clears any devnet bid. accept_optimistic itself already defaults true in helix.
const DEFAULT_COLLATERAL = "1000000000000000000000000";

const DEFAULT_API_PORT = 4040;
const DEFAULT_TCP_PORT = 4041;
const DEFAULT_WEBSITE_PORT = 9060;
// helix serves prometheus metrics from start_metrics_server on $METRICS_PORT
// (default 9500). Exposed so the bench's prometheus can scrape helix-native
// metrics (helix_request_latency_secs, helix_submission_trace_latency_us, …).
const DEFAULT_METRICS_PORT = 9500;
const DEFAULT_RELAY_KEY = "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11";
const DEFAULT_ADMIN_TOKEN = "decker";
const DEFAULT_POSTGRES_PASSWORD = "helix";

export const ports: Ports = {
  http: DEFAULT_API_PORT,
  tcp: DEFAULT_TCP_PORT,
  website: DEFAULT_WEBSITE_PORT,
  metrics: DEFAULT_METRICS_PORT,
};

type HelixYamlOpts = {
  beaconUrl: string;
  simUrl: string;
  apiPort: number;
  tcpPort: number;
  headerDelay: boolean;
  optimistic: boolean;
  builderPubkeys: string[];
  collateral: string;
  coreCount: number;
};

// helix hard-pins each tile thread to a CPU id via core_affinity, and `cores` is
// a required config block — so the layout determines whether helix's pipeline runs
// in parallel or all on one core. Spread the tiles across the host's cores: the
// auctioneer (the single-threaded serial stage) gets its own core, and the async
// HTTP runtime (serves submitBlock + getHeader) and the decoder get the largest
// shares; background tiles share core 0. On a small host pinning to high core ids
// would fail, so fall back to the original single-core layout. coreCount is the
// host's logical CPUs (the devnet sets no cpuset, so the container sees them all).
function helixCoresYaml(coreCount: number): string {
  if (coreCount < 8) {
    return `cores:
  auctioneer: 0
  tokio: [0]
  reg_workers: [0]
  tcp_bid_submissions_tile: 0
  decoder: [0]
  simulator: 0
  top_bid: 0`;
  }
  const pool = Array.from({ length: coreCount - 2 }, (_, i) => i + 2); // cores 2 … n-1
  const tcp = pool.pop()!;
  const sim = pool.pop()!;
  const reg = [pool.pop()!, pool.pop()!];
  const half = Math.ceil(pool.length / 2);
  const tokio = pool.slice(0, half); // bigger share → HTTP runtime
  const decoder = pool.slice(half); //  remainder → decode/deserialize
  return `cores:
  auctioneer: 1
  tokio: [${tokio.join(", ")}]
  reg_workers: [${reg.join(", ")}]
  tcp_bid_submissions_tile: ${tcp}
  decoder: [${decoder.join(", ")}]
  simulator: ${sim}
  top_bid: 0
  data_gatherer: 0`;
}

// Register every builder (one entry per pubkey) so each is a known builder;
// is_optimistic toggles the path: false = pessimistic (wait on sim), true = fast
// path (accept before sim). Multi-builder runs pass several pubkeys here so the
// auctioneer's bid sorter actually tracks N distinct builders.
function buildersBlock(o: HelixYamlOpts): string {
  const entries = o.builderPubkeys.map((pk) =>
    `  - pub_key: "${pk}"
    builder_info:
      collateral: "${o.collateral}"
      is_optimistic: ${o.optimistic}
      is_optimistic_for_regional_filtering: false`
  ).join("\n");
  return `builders:\n${entries}`;
}

function helixYaml(o: HelixYamlOpts): string {
  return `\
postgres:
  hostname: 127.0.0.1
  port: 5432
  db_name: postgres
  user: postgres
  region: 0
  region_name: "LOCAL"
simulators:
  - url: ${o.simUrl}
beacon_clients:
  - url: ${o.beaconUrl}
relays: []
${buildersBlock(o)}
validator_preferences:
  filtering: global
  trusted_builders: null
  header_delay: ${o.headerDelay}
router_config:
  enabled_routes:
    - route: All
target_get_payload_propagation_duration_ms: 0
primev_config: null
discord_webhook_url: null
alerts_config: null
inclusion_list: null
is_submission_instance: true
is_registration_instance: true
website:
  enabled: false
${helixCoresYaml(o.coreCount)}
api_port: ${o.apiPort}
tcp_port: ${o.tcpPort}
`;
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  const sim = def.refs?.sim;
  if (!beacon) throw new Error(`helix ${def.name}: missing refs.beacon`);
  if (!sim) throw new Error(`helix ${def.name}: missing refs.sim`);

  const apiPort = (def.config?.apiPort as number | undefined) ?? DEFAULT_API_PORT;
  const tcpPort = (def.config?.tcpPort as number | undefined) ?? DEFAULT_TCP_PORT;
  const websitePort = (def.config?.websitePort as number | undefined) ?? DEFAULT_WEBSITE_PORT;
  const metricsPort = (def.config?.metricsPort as number | undefined) ?? DEFAULT_METRICS_PORT;
  const relayKey = (def.config?.relayKey as string | undefined) ?? DEFAULT_RELAY_KEY;
  const adminToken = (def.config?.adminToken as string | undefined) ?? DEFAULT_ADMIN_TOKEN;
  const postgresPassword = (def.config?.postgresPassword as string | undefined) ?? DEFAULT_POSTGRES_PASSWORD;
  // Bench knobs: optimistic enables the fast path for the builder; headerDelay
  // off measures raw getHeader serve latency (defaults preserve standalone behaviour).
  const optimistic = (def.config?.optimistic as boolean | undefined) ?? false;
  const headerDelay = (def.config?.headerDelay as boolean | undefined) ?? true;
  const builderPubkeys = (def.config?.builderPubkeys as string[] | undefined) ?? [RELAY_BUILDER_PUBKEY];
  const collateral = (def.config?.collateral as string | undefined) ?? DEFAULT_COLLATERAL;
  // Distribute helix's tiles across the host's CPUs (override with config.coreCount).
  const coreCount = (def.config?.coreCount as number | undefined) ?? navigator.hardwareConcurrency;

  return {
    container: {
      image: "ghcr.io/gattaca-com/helix-relay:main",
      args: ["--config", "/config/helix.yml"],
      env: {
        RELAY_KEY: relayKey,
        ADMIN_TOKEN: adminToken,
        POSTGRES_PASSWORD: postgresPassword,
        METRICS_PORT: String(metricsPort),
      },
      ports: { http: apiPort, tcp: tcpPort, website: websitePort, metrics: metricsPort },
      volumeMounts: [
        { name: "relay-logs", mountPath: "/app/logs" },
      ],
    },
    volumes: [
      { name: "relay-logs", kind: "ephemeral" },
    ],
    configs: [
      {
        filename: "helix.yml",
        content: helixYaml({
          beaconUrl: ctx.url(beacon, "http"),
          simUrl: ctx.url(sim, "rpc"),
          apiPort,
          tcpPort,
          headerDelay,
          optimistic,
          builderPubkeys,
          collateral,
          coreCount,
        }),
        mountPath: "/config/helix.yml",
      },
    ],
  };
}
