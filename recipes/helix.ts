import type { ContainerDef, ContainerResult, Ctx, Ports, Prototype, Recipe } from "../utils/types.ts";
import { buildContainer as buildBeaconContainer } from "../containers/lighthouse-beacon.ts";

const postgres: Prototype = {
  ports: { postgres: 5432 },
  buildContainer: (_def: ContainerDef, _ctx: Ctx): ContainerResult => ({
    container: {
      image: "docker.io/timescale/timescaledb-ha:pg17",
      env: {
        POSTGRES_PASSWORD: "helix",
        PGDATA: "/var/lib/postgresql/data/pgdata",
      },
      ports: { postgres: 5432 },
      volumeMounts: [{ name: "pgdata", mountPath: "/var/lib/postgresql/data" }],
    },
    volumes: [{ name: "pgdata", kind: "ephemeral" }],
  }),
};

const simPort = 8555;
const simAuthrpcPort = 18551;

const helixSimulator: Prototype = {
  ports: { rpc: simPort, authrpc: simAuthrpcPort },
  buildContainer: (_def: ContainerDef, _ctx: Ctx): ContainerResult => ({
    container: {
      image: "ghcr.io/gattaca-com/helix-simulator:main",
      env: {
        RELAY_KEY: "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11",
      },
      args: [
        "node",
        "--chain", "/artifacts/genesis.json",
        "--datadir", "/data_sim",
        "--color", "never",
        "--http",
        "--http.addr", "0.0.0.0",
        "--http.api", "all",
        "--http.port", String(simPort),
        "--authrpc.addr", "0.0.0.0",
        "--authrpc.port", String(simAuthrpcPort),
        "--authrpc.jwtsecret", "/artifacts/jwtsecret",
        "--disable-discovery",
        "--enable-ext",
        "--builder-collateral-map-path", "/config/collateral.json",
        "--relay-fee-recipient", "0x0000000000000000000000000000000000000000",
        "--multisend-contract", "0x0000000000000000000000000000000000000000",
      ],
      ports: { rpc: simPort, authrpc: simAuthrpcPort },
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "sim-data",  mountPath: "/data_sim" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "sim-data",  kind: "ephemeral" },
    ],
    configs: [
      { filename: "collateral.json", content: "{}\n", mountPath: "/config/collateral.json" },
    ],
  }),
};

const helixBeaconPorts: Ports = {
  http: 13500,
  "p2p-tcp": { port: 19000, protocol: "TCP", service: false },
  "p2p-udp": { port: 19000, protocol: "UDP", service: false },
  quic:      { port: 19100, protocol: "UDP", service: false },
};

const helixBeacon: Prototype = {
  ports: helixBeaconPorts,
  buildContainer: (def: ContainerDef, ctx: Ctx): ContainerResult =>
    buildBeaconContainer({ ...def, config: { ...def.config, ports: helixBeaconPorts } }, ctx),
};

const relayApiPort = 4040;
const relayTcpPort = 4041;
const websitePort = 9060;

const helixYaml = (beaconUrl: string, simUrl: string) => `\
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
api_port: ${relayApiPort}
tcp_port: ${relayTcpPort}
`;

const helixRelay: Prototype = {
  ports: { http: relayApiPort, tcp: relayTcpPort, website: websitePort },
  buildContainer: (def: ContainerDef, ctx: Ctx): ContainerResult => {
    const beacon = def.refs?.beacon;
    const sim = def.refs?.sim;
    if (!beacon) throw new Error(`helix ${def.name}: missing refs.beacon`);
    if (!sim) throw new Error(`helix ${def.name}: missing refs.sim`);
    return {
      container: {
        image: "ghcr.io/gattaca-com/helix-relay:main",
        args: ["--config", "/config/helix.yml"],
        env: {
          RELAY_KEY: "0x64496d4e301e541a6e1237d6ef13a8f8b8b6cb82be9d8ac90073a833dfc2af11",
          ADMIN_TOKEN: "decker",
          POSTGRES_PASSWORD: "helix",
        },
        ports: { http: relayApiPort, tcp: relayTcpPort, website: websitePort },
        volumeMounts: [
          { name: "relay-logs", mountPath: "/app/logs" },
        ],
      },
      volumes: [
        { name: "relay-logs", kind: "ephemeral" },
      ],
      configs: [
        { filename: "helix.yml", content: helixYaml(ctx.url(beacon, "http"), ctx.url(sim, "rpc")), mountPath: "/config/helix.yml" },
      ],
    };
  },
};

export const recipe: Recipe = {
  artifacts: "l1",
  artifactsArgs: ["--latest-fork"],
  pods: [
    {
      name: "el-1",
      shareProcessNamespace: true,
      containers: [
        { name: "el-1",       prototype: "reth" },
        {
          name: "rbuilder-1",
          prototype: "rbuilder",
          refs: { el: "el-1", beacon: "beacon-1", relay: "helix-1" },
        },
      ],
    },
    {
      name: "beacon-1",
      containers: [
        {
          name: "beacon-1",
          prototype: "lighthouse-beacon",
          refs: { el: "el-1", builder: "helix-1", peer: "helix-beacon-1" },
        },
      ],
    },
    {
      name: "validator-1",
      containers: [
        { name: "validator-1", prototype: "lighthouse-validator", refs: { beacon: "beacon-1" } },
      ],
    },
    {
      name: "helix-sim-1",
      containers: [
        { name: "helix-sim-1", prototype: helixSimulator },
      ],
    },
    {
      name: "helix-beacon-1",
      containers: [
        {
          name: "helix-beacon-1",
          prototype: helixBeacon,
          refs: { el: "helix-sim-1", peer: "beacon-1" },
        },
      ],
    },
    {
      name: "helix-1",
      containers: [
        { name: "postgres-1", prototype: postgres },
        {
          name: "helix-1",
          prototype: helixRelay,
          refs: { beacon: "helix-beacon-1", sim: "helix-sim-1" },
        },
      ],
    },
  ],
};
