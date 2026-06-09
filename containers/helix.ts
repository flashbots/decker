import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

const DEFAULT_API_PORT = 4040;
const DEFAULT_TCP_PORT = 4041;
const DEFAULT_WEBSITE_PORT = 9060;
const DEFAULT_RELAY_KEY = "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11";
const DEFAULT_ADMIN_TOKEN = "decker";
const DEFAULT_POSTGRES_PASSWORD = "helix";

export const ports: Ports = {
  http: DEFAULT_API_PORT,
  tcp: DEFAULT_TCP_PORT,
  website: DEFAULT_WEBSITE_PORT,
};

function helixYaml(beaconUrl: string, simUrl: string, apiPort: number, tcpPort: number): string {
  return `\
postgres:
  hostname: 127.0.0.1
  port: 5432
  db_name: postgres
  user: postgres
  region: 0
  region_name: "LOCAL"
simulators:
  - url: ${simUrl}
beacon_clients:
  - url: ${beaconUrl}
relays: []
builders: []
validator_preferences:
  filtering: global
  trusted_builders: null
  header_delay: true
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
cores:
  auctioneer: 0
  tokio: [0]
  reg_workers: [0]
  tcp_bid_submissions_tile: 0
  decoder: [0]
  simulator: 0
  top_bid: 0
api_port: ${apiPort}
tcp_port: ${tcpPort}
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
  const relayKey = (def.config?.relayKey as string | undefined) ?? DEFAULT_RELAY_KEY;
  const adminToken = (def.config?.adminToken as string | undefined) ?? DEFAULT_ADMIN_TOKEN;
  const postgresPassword = (def.config?.postgresPassword as string | undefined) ?? DEFAULT_POSTGRES_PASSWORD;

  return {
    container: {
      image: "ghcr.io/gattaca-com/helix-relay:main",
      args: ["--config", "/config/helix.yml"],
      env: {
        RELAY_KEY: relayKey,
        ADMIN_TOKEN: adminToken,
        POSTGRES_PASSWORD: postgresPassword,
      },
      ports: { http: apiPort, tcp: tcpPort, website: websitePort },
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
        content: helixYaml(ctx.url(beacon, "http"), ctx.url(sim, "rpc"), apiPort, tcpPort),
        mountPath: "/config/helix.yml",
      },
    ],
  };
}
