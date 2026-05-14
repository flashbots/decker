import type { Recipe } from "../utils/types.ts";

export const recipe: Recipe = {
  artifacts: "l1",
  pods: [
    {
      name: "el-1",
      containers: [
        { name: "el-1", prototype: "reth" },
      ],
    },
    {
      name: "beacon-1",
      containers: [
        { name: "beacon-1", prototype: "lighthouse-beacon", refs: { el: "el-1" } },
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
