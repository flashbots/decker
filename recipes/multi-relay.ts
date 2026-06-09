import type { ContainerDef, ContainerResult, Ctx, Ports, Prototype, Recipe } from "../utils/types.ts";
import { buildContainer as buildBeaconContainer } from "../containers/lighthouse-beacon.ts";
import { relayWarmup } from "../scripts/relay-warmup.ts";

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

// beacon-2 follows beacon-1 over CL libp2p and drives reth-2 via engine API.
// Port-shifted off beacon-1's defaults to avoid hostPort collisions.
const beacon2Ports: Ports = {
  http:      23500,
  "p2p-tcp": { port: 29000, protocol: "TCP", service: false },
  "p2p-udp": { port: 29000, protocol: "UDP", service: false },
  quic:      { port: 29100, protocol: "UDP", service: false },
};

const beacon2: Prototype = {
  ports: beacon2Ports,
  buildContainer: (def: ContainerDef, ctx: Ctx): ContainerResult =>
    buildBeaconContainer({ ...def, config: { ...def.config, ports: beacon2Ports } }, ctx),
};

// reth-2 ports are shifted so its hostPorts don't collide with reth-1's
// (the dev renderer maps every containerPort 1:1 to hostPort).
const reth2Ports: Ports = {
  rpc:     18545,
  authrpc: 28551,
  metrics: 19090,
};

const mevPostgresPort = 5433;

const HELIX_RELAY_PUBKEY =
  "0xb34cde46f57a246f10dd73ed8714c665dc187b2888353f0b8676c8790e1599de0e96e2a7d515db99126f8d62b7d44ca1";
const MEV_BOOST_RELAY_PUBKEY =
  "0xa1885d66bef164889a2e35845c3b626545d7b0e513efe335e97c3a45e534013fa3bc38c3b7e6143695aecc4872ac52c4";

export const recipe: Recipe = {
  artifacts: { generator: "l1", fork: "fulu" },
  scripts: [
    relayWarmup({
      relays: [{ container: "mev-boost-relay-1" }],
    }),
  ],
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
      name: "el-2",
      shareProcessNamespace: true,
      containers: [
        { name: "el-2", prototype: "reth", config: { ports: reth2Ports } },
        {
          name: "rbuilder-2",
          prototype: "rbuilder",
          refs: { el: "el-2", beacon: "beacon-2", relay: "mev-boost-relay-1" },
          config: { port: 8845 },
        },
      ],
    },
    {
      name: "beacon-1",
      containers: [
        {
          name: "beacon-1",
          prototype: "lighthouse-beacon",
          refs: { el: "el-1", builder: "mev-boost-1", peer: "helix-beacon-1" },
        },
      ],
    },
    {
      name: "beacon-2",
      containers: [
        {
          name: "beacon-2",
          prototype: beacon2,
          refs: { el: "el-2", peer: "beacon-1" },
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
        { name: "helix-sim-1", prototype: "helix-simulator" },
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
        { name: "postgres-1", prototype: "helix-postgres" },
        {
          name: "helix-1",
          prototype: "helix",
          refs: { beacon: "helix-beacon-1", sim: "helix-sim-1" },
        },
      ],
    },
    {
      name: "mev-boost-relay-1",
      containers: [
        { name: "pg-mb-1",    prototype: "mev-boost-relay-postgres", config: { ports: { postgres: mevPostgresPort } } },
        { name: "redis-mb-1", prototype: "redis" },
        {
          name: "housekeeper-mb-1",
          prototype: "mev-boost-housekeeper",
          refs: { beacon: "beacon-1", postgres: "pg-mb-1", redis: "redis-mb-1" },
        },
        {
          name: "mev-boost-relay-1",
          prototype: "mev-boost-relay",
          refs: { beacon: "beacon-1", postgres: "pg-mb-1", redis: "redis-mb-1", el: "el-1" },
        },
      ],
    },
    {
      name: "mev-boost-1",
      containers: [
        {
          name: "mev-boost-1",
          prototype: "mev-boost",
          config: {
            relays: [
              { name: "helix-1",           pubkey: HELIX_RELAY_PUBKEY },
              { name: "mev-boost-relay-1", pubkey: MEV_BOOST_RELAY_PUBKEY },
            ],
          },
        },
      ],
    },
  ],
};
