import type { Recipe } from "../utils/types.ts";
import { pipelineCheck } from "../scripts/pipeline-check.ts";
import { relayWarmup } from "../scripts/relay-warmup.ts";

// reth + rbuilder run as a single host binary (`reth-rbuilder`); everything else
// runs in containers. The binary is built from the rbuilder reth 2.2 migration
// fork and decker clones + compiles it automatically on first `up`:
//   https://github.com/faheelsattar/rbuilder/tree/faheel/reth-2.2-migration
// (see containers/reth-rbuilder.ts and utils/binary-build.ts). The first run
// triggers a full cargo build; the binary is then cached under cache/bins/.
export const recipe: Recipe = {
  artifacts: { generator: "l1", fork: "fulu" },
  scripts: [
    relayWarmup({
      relays: [{ container: "mev-boost-relay-1" }],
    }),
    // Post-up smoke test: sends a test tx and, on failure, names the suspect
    // component with its own error (see scripts/pipeline-check.ts).
    pipelineCheck(),
  ],
  pods: [
    {
      name: "beacon-1",
      containers: [
        // supernode: custody all data columns so the legacy blob_sidecars API can
        // serve full blobs post-Fulu (blobscan's indexer needs this).
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
    // Blockscout (EL), and Blobscan (blobs). el-1 is the host reth-rbuilder
    // process; the explorers reach it server-side via the host gateway (and the
    // Blockscout frontend's browser RPC via localhost). Their UI URLs print in
    // the `up` summary after the Dozzle line.
    {
      name: "dora",
      containers: [
        // 8080 is taken by process-compose's own control server; 8081 is free.
        { name: "dora", prototype: "dora", config: { ports: { http: 8081 } }, refs: { beacon: "beacon-1", el: "el-1" } },
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
          refs: { postgres: "blobscan-pg", redis: "blobscan-redis" },
        },
        {
          name: "blobscan-indexer",
          prototype: "blobscan-indexer",
          refs: { beacon: "beacon-1", el: "el-1", api: "blobscan-api" },
        },
      ],
    },
  ],
  processes: [
    // reth node + rbuilder in one process; serves as the EL (el-1) for the
    // beacon (authrpc) and the relay's block simulation (rpc).
    {
      name: "el-1",
      prototype: "reth-rbuilder",
      refs: { beacon: "beacon-1", relay: "mev-boost-relay-1" },
      // Local hacking: point at your own build to skip the clone+build pipeline.
      // Build it in your own checkout (NOT cache/sources/rbuilder — decker
      // resets that to origin on rebuild, wiping local edits):
      //   cargo build --release --bin reth-rbuilder
      // binary: "/in/your/filesystem/rbuilder/target/release/reth-rbuilder",
    },
  ],
};
