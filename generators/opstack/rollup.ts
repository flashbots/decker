// Renders rollup.json (the op-node rollup config) from the selected L2 fork's
// template. Everything except the three run-variable anchors is baked in; here
// we patch:
//   - genesis.l1.hash → the L1 genesis block hash (must equal what the L1 EL
//     computes for block 0)
//   - genesis.l2.hash → the L2 genesis block hash (must equal what op-geth
//     computes for block 0)
//   - genesis.l2_time → the L2 genesis timestamp
// If any of these disagree with the running clients, op-node refuses to start.

import { loadGzJson } from "./template.ts";

const toHex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export type RollupOpts = {
  templateUrl: URL;
  l1Hash: Uint8Array;
  l2Hash: Uint8Array;
  l2TimeSeconds: number;
  // L2 block time (op-node's sequencing cadence). Omitted → keep the template's.
  blockTimeSeconds?: number;
  // Extra top-level fields (e.g. a fork's `<fork>_time`) merged in for a fork
  // that reuses another's rollup template.
  extra?: Record<string, unknown>;
};

export async function renderRollup(opts: RollupOpts): Promise<string> {
  const r = await loadGzJson(opts.templateUrl);
  r.genesis.l1.hash = toHex(opts.l1Hash);
  r.genesis.l2.hash = toHex(opts.l2Hash);
  r.genesis.l2_time = opts.l2TimeSeconds;
  if (opts.blockTimeSeconds !== undefined) r.block_time = opts.blockTimeSeconds;
  if (opts.extra) Object.assign(r, opts.extra);
  return JSON.stringify(r, null, " ");
}
