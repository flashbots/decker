// Renders the OP-stack L1 genesis.json from the selected L2 fork's template (the
// OP system contracts differ per L2 fork). Only the post-merge fork activation
// times and the top-level timestamp vary per run — all set to genesisTime so
// every fork is active at genesis. l1Fork "fulu" additionally enables Osaka
// (the EL counterpart); this does not change the genesis block hash.

import { loadGzJson } from "./template.ts";

export async function renderL1Genesis(
  templateUrl: URL,
  genesisTimeSeconds: number,
  l1Fork: string,
): Promise<string> {
  const g = await loadGzJson(templateUrl);
  g.config.shanghaiTime = genesisTimeSeconds;
  g.config.cancunTime = genesisTimeSeconds;
  g.config.pragueTime = genesisTimeSeconds;
  if (l1Fork === "fulu") g.config.osakaTime = genesisTimeSeconds;
  g.timestamp = `0x${genesisTimeSeconds.toString(16)}`;
  return JSON.stringify(g, null, "\t");
}
