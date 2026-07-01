import type { Recipe } from "../utils/types.ts";
import { relayWarmup } from "../scripts/relay-warmup.ts";

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
      containers: [
        // trace,debug + open CORS so Blockscout can index traces and the
        // explorers' browser-side RPC can reach the node.
        {
          name: "el-1",
          prototype: "reth",
          config: { rpcApi: "admin,eth,web3,net,rpc,mev,flashbots,trace,debug", corsdomain: "*" },
        },
      ],
    },
    {
      name: "beacon-1",
      containers: [
        // supernode: custody all data columns so the legacy blob_sidecars API can
        // serve full blobs post-Fulu (blobscan's indexer needs this — see below).
        { name: "beacon-1", prototype: "lighthouse-beacon", config: { supernode: true }, refs: { el: "el-1", builder: "mev-boost-relay-1" } },
      ],
    },
    {
      name: "validator-1",
      containers: [
        { name: "validator-1", prototype: "lighthouse-validator", refs: { beacon: "beacon-1" } },
      ],
    },
    {
      name: "mev-boost-relay-1",
      containers: [
        { name: "pg-mb-1",    prototype: "mev-boost-relay-postgres" },
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
    // Block explorers, as shipped by the Kurtosis ethereum-package: Dora (CL),
    // Blockscout (EL), and Blobscan (blobs). Their UI URLs print in the `up`
    // summary after the Dozzle line.
    {
      name: "dora",
      containers: [
        { name: "dora", prototype: "dora", refs: { beacon: "beacon-1", el: "el-1" } },
      ],
    },
    {
      name: "blockscout",
      containers: [
        { name: "blockscout-pg",    prototype: "postgres", config: { database: "blockscout", ports: { postgres: 5433 } } },
        { name: "blockscout-verif", prototype: "blockscout-verif" },
        {
          name: "blockscout",
          prototype: "blockscout",
          refs: { el: "el-1", postgres: "blockscout-pg", verif: "blockscout-verif" },
        },
        {
          name: "blockscout-frontend",
          prototype: "blockscout-frontend",
          refs: { backend: "blockscout", el: "el-1" },
        },
      ],
    },
    {
      name: "blobscan",
      containers: [
        { name: "blobscan-pg",    prototype: "postgres", config: { database: "blobscan", ports: { postgres: 5434 } } },
        { name: "blobscan-redis", prototype: "redis", config: { ports: { redis: 6380 } } },
        {
          name: "blobscan-api",
          prototype: "blobscan-api",
          // 3001 is taken on this host by a standing grafana container; 3003 is free.
          // chainId 560048 = hoodi: blobscan only supports mainnet/gnosis/sepolia/
          // hoodi, so this post-Pectra devnet masquerades as the newest of those.
          config: { ports: { http: 3003 }, chainId: 560048 },
          refs: { postgres: "blobscan-pg", redis: "blobscan-redis" },
        },
        {
          name: "blobscan-web",
          prototype: "blobscan-web",
          refs: { postgres: "blobscan-pg" },
        },
        {
          name: "blobscan-indexer",
          prototype: "blobscan-indexer",
          refs: { beacon: "beacon-1", el: "el-1", api: "blobscan-api" },
        },
      ],
    },
  ],
};
