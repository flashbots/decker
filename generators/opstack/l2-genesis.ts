// Renders the L2 (OP-stack) genesis.json from the selected L2 fork's template.
// The alloc and all L2 fork times are baked in; only the top-level timestamp
// varies per run (it starts OP_TIMESTAMP_OFFSET_SECONDS after the L1 genesis).
// The alloc is untouched, so the state root is unchanged and the genesis block
// hash follows from computeOpGenesisHash().

import { loadGzJson } from "./template.ts";

export async function renderL2Genesis(
  templateUrl: URL,
  opTimestampSeconds: number,
  configExtra?: Record<string, unknown>,
): Promise<string> {
  const g = await loadGzJson(templateUrl);
  g.timestamp = `0x${opTimestampSeconds.toString(16)}`;
  // A fork reusing another's template flips on its own activation time here
  // (e.g. karst on jovian's contracts). Additive-only: never changes the alloc.
  if (configExtra) Object.assign(g.config, configExtra);
  return JSON.stringify(g, null, "\t");
}
