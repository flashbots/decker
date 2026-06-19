import type { Recipe } from "../utils/types.ts";
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
  ],
  pods: [
    {
      name: "beacon-1",
      containers: [
        { name: "beacon-1", prototype: "lighthouse-beacon", refs: { el: "el-1", builder: "mev-boost-relay-1" } },
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
  ],
  processes: [
    // reth node + rbuilder in one process; serves as the EL (el-1) for the
    // beacon (authrpc) and the relay's block simulation (rpc).
    {
      name: "el-1",
      prototype: "reth-rbuilder",
      refs: { beacon: "beacon-1", relay: "mev-boost-relay-1" },
    },
  ],
};
