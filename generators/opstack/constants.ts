// Fork-independent constants for the OP-stack artifact generator. Per-fork
// constants (state roots, templates, extraData) live in forks.ts.

// The L2 genesis starts 2 seconds after the L1 genesis (op-node requires the L2
// genesis L1-origin to be at or before the first L2 block).
export const OP_TIMESTAMP_OFFSET_SECONDS = 2;
