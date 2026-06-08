// Builds the Geth-style L1 genesis.json. Static parts (fork blocks, deposit
// contract bytecode + storage, hardhat prefunded accounts, Prysm "interop"
// vault) are vendored in el-genesis-template.json with time fields zeroed.
// Only the three post-merge fork activation times and the top-level timestamp
// vary per run — all set to genesisTime so Prague is active at genesis.

const TEMPLATE_URL = new URL("./el-genesis-template.json", import.meta.url);

export type ElGenesisOpts = {
  genesisTimeSeconds: number;
};

export async function renderElGenesis(opts: ElGenesisOpts): Promise<string> {
  const t = opts.genesisTimeSeconds;
  const raw = await Deno.readTextFile(TEMPLATE_URL);
  const g = JSON.parse(raw);
  g.config.shanghaiTime = t;
  g.config.cancunTime = t;
  g.config.pragueTime = t;
  g.timestamp = `0x${t.toString(16)}`;
  return JSON.stringify(g, null, "\t");
}
