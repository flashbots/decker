import type { Pod, ProcessDef, Recipe } from "../utils/types.ts";
import { BOOTNODE_ID } from "../containers/bootnode.ts";

// An OP stack, ported from builder-playground's `opstack` recipe. The artifacts
// generator bakes the OP system contracts into the L1 genesis and emits the L2
// genesis + rollup config alongside the usual L1 CL/EL files (see generators/opstack).
//
// This is a *factory* recipe: `recipe(options)` builds it from the options below
// (all optional, defaults shown). Pass them from a decker.ts `options` block or
// `decker up opstack --opt l2Fork=jovian --opt externalBuilder=op-rbuilder`.
export type OpstackOptions = {
  l1Fork?: string; // electra | fulu                 (default fulu)
  l2Fork?: string; // isthmus | jovian | karst        (default karst)
  l2BlockTime?: number | string; // L2 seconds/block  (default 2; try 1)
  // Set to "op-rbuilder" to run a separate block builder behind rollup-boost
  // (op-node drives rollup-boost, which asks op-rbuilder for a block and falls
  // back to the local EL). Works with all forks — the local EL (op-geth or
  // op-reth) joins the bootnode so the builder peers + gets mempool txs.
  externalBuilder?: string | false; // (default off)
  // Run op-rbuilder as a HOST PROCESS instead of the pinned container.
  // A string as a path to a prebuilt op-rbuilder binary; `true` (or the CLI's
  // `--opt builderBinary=true`) builds it from source on `up` instead.
  // Moves op-rbuilder from `pods` to `recipe.processes`. The sequencer L2 EL
  // gets a deterministic p2p identity + its p2p port published to the host so
  // op-rbuilder can trusted-peer-dial it directly instead of going through the
  // container-mode bootnode, which the host can't reach. (default off)
  builderBinary?: string | boolean;
};

export function recipe(o: OpstackOptions = {}): Recipe {
  const l1Fork = o.l1Fork ?? "fulu";
  const l2Fork = o.l2Fork ?? "karst";
  const l2BlockTime = Number(o.l2BlockTime ?? 2);
  const externalBuilder = o.externalBuilder && o.externalBuilder !== "false" ? String(o.externalBuilder) : false;

  // "true" and  CLI's  "true" (`--opt builderBinary=true`) mean "auto-build";
  // any other string is a path to a prebuilt binary.
  const builderBinaryOpt = o.builderBinary;
  const builderHostProcess = builderBinaryOpt !== undefined && builderBinaryOpt !== false && builderBinaryOpt !== "false";
  const builderBinaryPath = builderHostProcess && builderBinaryOpt !== true && builderBinaryOpt !== "true"
    ? String(builderBinaryOpt)
    : undefined;
  if (builderHostProcess && externalBuilder !== "op-rbuilder") {
    throw new Error(`opstack: builderBinary requires externalBuilder="op-rbuilder" (got ${externalBuilder || "false"})`);
  }

  // L2 execution client selection. Karst (OP Upgrade 19) ends op-geth support, so
  // from Karst on the L2 EL is op-reth and op-node needs a newer release. Forks
  // up to jovian keep the op-geth client set they were verified with.
  const OP_GETH_FORKS = new Set(["isthmus", "jovian"]);
  const l2El = OP_GETH_FORKS.has(l2Fork) ? "op-geth" : "op-reth";
  const opNodeConfig = OP_GETH_FORKS.has(l2Fork) ? undefined : { tag: "v1.19.1" };
  // Blockscout's trace dialect follows the L2 EL: reth speaks the erigon/parity
  // trace API, op-geth speaks debug_trace*.
  const l2Variant = l2El === "op-reth" ? "erigon" : "geth";

  // With an external builder, op-node drives rollup-boost instead of the EL.
  // Container mode: the local EL joins the bootnode so op-rbuilder can peer +
  // sync the chain over pod-network discovery. Process mode: discovery can't
  // cross the host/pod-network boundary, so instead the EL gets a fixed p2p
  // identity + host-published p2p port for op-rbuilder to trusted-peer-dial
  // directly.
  const l2Engine = externalBuilder ? "rollup-boost" : l2El;
  const l2ElConfig = builderHostProcess
    ? { ports: { p2p: { port: 30303, service: false } } }
    : (externalBuilder ? { bootnodeId: BOOTNODE_ID } : undefined);
  const builderPods: Pod[] = externalBuilder
    ? [
      // The bootnode is only needed for container mode's discovery-based
      // peering; a host-process op-rbuilder dials the EL directly (see above).
      ...(builderHostProcess ? [] : [
        { name: "bootnode", containers: [{ name: "bootnode", prototype: "bootnode" }] },
        { name: "op-rbuilder", containers: [{ name: "op-rbuilder", prototype: "op-rbuilder" }] },
      ]),
      {
        name: "rollup-boost",
        containers: [
          { name: "rollup-boost", prototype: "rollup-boost", refs: { l2: l2El, builder: "op-rbuilder" } },
        ],
      },
    ]
    : [];
  const builderProcesses: ProcessDef[] = builderHostProcess
    ? [
      {
        name: "op-rbuilder",
        prototype: "op-rbuilder",
        refs: { l2: l2El },
        ...(builderBinaryPath ? { binary: builderBinaryPath } : {}),
      },
    ]
    : [];

  // L1: reth (el-1) + lighthouse beacon/validator produce the settlement chain.
  // L2: the sequencer EL (op-geth/op-reth by fork) is driven by op-node (directly,
  //     or via rollup-boost with an external builder); op-batcher posts L2 batches
  //     back to L1 as calldata. Ports are chosen clear of the L1 clients so
  //     `decker up` can host-expose everything without collisions.
  return {
    artifacts: { generator: "opstack", l1Fork, l2Fork, l2BlockTimeSeconds: l2BlockTime },
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
          { name: l2El, prototype: l2El, config: l2ElConfig },
        ],
      },
      // The builder pipeline (bootnode + op-rbuilder + rollup-boost), only when an
      // external builder is enabled.
      ...builderPods,
      {
        name: "op-node",
        containers: [
          {
            name: "op-node",
            prototype: "op-node",
            // Drives rollup-boost with an external builder, else the EL directly.
            refs: { l1: "el-1", l1beacon: "beacon-1", l2: l2Engine },
            config: opNodeConfig,
          },
        ],
      },
      {
        name: "op-batcher",
        // Reads L2 blocks straight from the EL (rollup-boost is engine-API only).
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
    ...(builderProcesses.length > 0 ? { processes: builderProcesses } : {}),
  };
}
