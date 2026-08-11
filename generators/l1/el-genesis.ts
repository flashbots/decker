// Builds the Geth-style L1 genesis.json. Static parts (fork blocks, deposit
// contract bytecode + storage, hardhat prefunded accounts, Prysm "interop"
// vault) are vendored in el-genesis-template.json with time fields zeroed.
// Only the post-merge fork activation times and the top-level timestamp
// vary per run — all set to genesisTime so the chosen fork is active at genesis.
//
// A recipe may add its own accounts (artifacts `genesisAccounts`), typically to
// predeploy a contract at a fixed address. Those change the genesis state root,
// which is why the caller computes it from the alloc returned here (see
// state-root.ts) instead of using a baked constant.

import type { GenesisAlloc } from "./state-root.ts";

const TEMPLATE_URL = new URL("./el-genesis-template.json", import.meta.url);

export type ElGenesisOpts = {
  genesisTimeSeconds: number;
  fork: string;
  genesisAccounts?: GenesisAlloc;
};

export type ElGenesisResult = {
  // The rendered genesis.json.
  json: string;
  // Its alloc, template plus extras, as the EL will see it.
  alloc: GenesisAlloc;
};

// Alloc keys are compared without the 0x prefix and case-insensitively, the way
// the EL reads them — otherwise "0xAbC…" would silently shadow "abc…".
function allocKey(address: string): string {
  return (address.startsWith("0x") || address.startsWith("0X") ? address.slice(2) : address).toLowerCase();
}

function mergeAlloc(template: GenesisAlloc, extra: GenesisAlloc | undefined): GenesisAlloc {
  if (!extra) return template;
  const out: GenesisAlloc = { ...template };
  const existing = new Set(Object.keys(template).map(allocKey));
  for (const [address, account] of Object.entries(extra)) {
    const key = allocKey(address);
    if (existing.has(key)) {
      throw new Error(`l1 artifacts: genesisAccounts 0x${key} is already in the genesis template`);
    }
    existing.add(key);
    out[key] = account;
  }
  return out;
}

export async function renderElGenesis(opts: ElGenesisOpts): Promise<ElGenesisResult> {
  const t = opts.genesisTimeSeconds;
  const raw = await Deno.readTextFile(TEMPLATE_URL);
  const g = JSON.parse(raw);
  g.config.shanghaiTime = t;
  g.config.cancunTime = t;
  g.config.pragueTime = t;
  if (opts.fork === "fulu") g.config.osakaTime = t;
  g.timestamp = `0x${t.toString(16)}`;
  g.alloc = mergeAlloc(g.alloc as GenesisAlloc, opts.genesisAccounts);
  return { json: JSON.stringify(g, null, "\t"), alloc: g.alloc as GenesisAlloc };
}
