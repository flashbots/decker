import type { Recipe } from "../utils/types.ts";
import { relayWarmup } from "../scripts/relay-warmup.ts";

export const recipe: Recipe = {
  artifacts: { generator: "l1", fork: "electra" },
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
    { name: "el-1", prototype: "reth" },
    {
      name: "rbuilder-1",
      prototype: "rbuilder",
      refs: { el: "el-1", beacon: "beacon-1", relay: "mev-boost-relay-1" },
    },
  ],
};
