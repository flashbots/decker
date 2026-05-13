import type { Recipe } from "../utils/types.ts";

export const recipe: Recipe = {
  artifacts: "l1",
  pods: [
    {
      name: "el-1",
      shareProcessNamespace: true,
      containers: [
        { name: "el-1",       prototype: "reth" },
        {
          name: "rbuilder-1",
          prototype: "rbuilder",
          refs: { el: "el-1", beacon: "beacon-1", relay: "mev-boost-relay-1" },
        },
      ],
    },
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
        { name: "mev-boost-relay-1", prototype: "mev-boost-relay", refs: { beacon: "beacon-1" } },
      ],
    },
  ],
};
