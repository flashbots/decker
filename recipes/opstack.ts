import type { Recipe } from "../utils/types.ts";

// An OP stack, ported from builder-playground's default `opstack` recipe (no
// external builder / flashblocks). The artifacts generator bakes the OP system
// contracts into the L1 genesis and emits the L2 genesis + rollup config
// alongside the usual L1 CL/EL files (see generators/opstack).
//
// The L1 consensus fork and the L2 OP fork are chosen independently here:
const l1Fork = "fulu"; //    electra | fulu
const l2Fork = "karst"; //   isthmus | jovian | karst

// L2 execution client selection. Karst (OP Upgrade 19) ends op-geth support, so
// from Karst on the L2 EL is op-reth and op-node needs a newer release. Forks up
// to jovian keep the op-geth client set they were verified with.
const OP_GETH_FORKS = new Set(["isthmus", "jovian"]);
const l2El = OP_GETH_FORKS.has(l2Fork) ? "op-geth" : "op-reth";
const opNodeConfig = OP_GETH_FORKS.has(l2Fork) ? undefined : { tag: "v1.19.1" };
// Blockscout's trace dialect follows the L2 EL: reth speaks the erigon/parity
// trace API, op-geth speaks debug_trace*.
const l2Variant = l2El === "op-reth" ? "erigon" : "geth";

// L1: reth (el-1) + lighthouse beacon/validator produce the settlement chain.
// L2: the sequencer EL (op-geth/op-reth by fork) is driven by op-node, which
//     derives from L1; op-batcher posts L2 batches back to L1 as calldata.
//
// Single sequencer, so there's no L2 P2P/bootnode — op-node builds blocks
// directly over the EL's engine API. The op-* ports are chosen clear of the L1
// clients so `decker up` can host-expose everything without collisions.
export const recipe: Recipe = {
  artifacts: { generator: "opstack", l1Fork, l2Fork },
  pods: [
    // --- L1 (settlement layer) ---
    {
      name: "el-1",
      containers: [
        // trace,debug + open CORS so the L1 Blockscout can index internal txs and
        // its browser-side RPC can reach the node directly.
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
        { name: "beacon-1", prototype: "lighthouse-beacon", refs: { el: "el-1" } },
      ],
    },
    {
      name: "validator-1",
      containers: [
        { name: "validator-1", prototype: "lighthouse-validator", refs: { beacon: "beacon-1" } },
      ],
    },
    // --- L2 (OP stack) ---
    {
      name: l2El,
      containers: [
        { name: l2El, prototype: l2El },
      ],
    },
    {
      name: "op-node",
      containers: [
        {
          name: "op-node",
          prototype: "op-node",
          refs: { l1: "el-1", l1beacon: "beacon-1", l2: l2El },
          config: opNodeConfig,
        },
      ],
    },
    {
      name: "op-batcher",
      containers: [
        {
          name: "op-batcher",
          prototype: "op-batcher",
          refs: { l1: "el-1", l2: l2El, rollup: "op-node" },
        },
      ],
    },
    // --- Block explorers: one Blockscout per layer. Each is a 4-container stack
    // (postgres + verifier + backend + frontend); the two stacks use disjoint
    // host ports. UI URLs print in the `up` summary.
    {
      name: "blockscout-l1",
      containers: [
        { name: "blockscout-l1-pg",    prototype: "postgres", config: { database: "blockscout", ports: { postgres: 5433 } } },
        { name: "blockscout-l1-verif", prototype: "blockscout-verif" },
        {
          name: "blockscout-l1",
          prototype: "blockscout",
          config: { variant: "erigon" }, // reth
          refs: { el: "el-1", postgres: "blockscout-l1-pg", verif: "blockscout-l1-verif" },
        },
        {
          name: "blockscout-l1-frontend",
          prototype: "blockscout-frontend",
          config: { networkId: "1337", networkName: "decker-l1", webuiLabel: "L1 explorer (Blockscout)" },
          refs: { backend: "blockscout-l1", el: "el-1" },
        },
      ],
    },
    {
      name: "blockscout-l2",
      containers: [
        { name: "blockscout-l2-pg",    prototype: "postgres",         config: { database: "blockscout", ports: { postgres: 5435 } } },
        { name: "blockscout-l2-verif", prototype: "blockscout-verif", config: { ports: { http: 8051 } } },
        {
          name: "blockscout-l2",
          prototype: "blockscout",
          config: { ports: { http: 4001 }, variant: l2Variant },
          refs: { el: l2El, postgres: "blockscout-l2-pg", verif: "blockscout-l2-verif" },
        },
        {
          name: "blockscout-l2-frontend",
          prototype: "blockscout-frontend",
          config: {
            ports: { http: 3003 },
            networkId: "13",
            networkName: "decker-l2",
            hasBeaconChain: false, // L2 rollup has no beacon chain
            webuiLabel: "L2 explorer (Blockscout)",
          },
          refs: { backend: "blockscout-l2", el: l2El },
        },
      ],
    },
  ],
};
