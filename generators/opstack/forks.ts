// The per-L2-fork data: which templates to patch and the baked constants needed
// to recompute the genesis block hashes. Every value here was captured from a
// reference `builder-playground start opstack [--enable-latest-fork 0]` run and
// verified by re-deriving the L1/L2 genesis block hashes in TS (see AGENTS.md).
//
// Adding a new L2 fork (e.g. karst, once builder-playground and the op-geth /
// op-node images ship it) is a drop-in: vendor its three templates, capture its
// four constants the same way, and add an entry below.

const fromHex = (h: string): Uint8Array => {
  if (h.startsWith("0x")) h = h.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};

export type L2ForkConfig = {
  // Templates (per fork: the L1 state dump, L2 predeploys, and rollup config all
  // differ). Vendored with the per-run time fields zeroed.
  l1GenesisTemplate: URL;
  l2GenesisTemplate: URL;
  rollupTemplate: URL;
  // L1 genesis state root once this fork's OP system contracts are merged in.
  // (L1-fork-invariant: enabling Osaka/Fulu doesn't change it.)
  l1StateRoot: Uint8Array;
  // L2 genesis block header pieces (the rest of the 21-field Isthmus-style header
  // is fork-invariant — see op-block-hash.ts).
  l2StateRoot: Uint8Array;
  l2WithdrawalsRoot: Uint8Array;
  l2ExtraData: Uint8Array;
  // Extra fields merged into the rendered artifacts at run time. A fork that
  // reuses another fork's op-deployer output (e.g. karst on jovian's contracts)
  // just flips on its own activation time here — the alloc, and therefore all
  // the baked constants above, are unchanged.
  l2ConfigExtra?: Record<string, unknown>; // → l2-genesis.json `config`
  rollupExtra?: Record<string, unknown>; //    → rollup.json (top level)
};

export const L2_FORKS: Record<string, L2ForkConfig> = {
  isthmus: {
    l1GenesisTemplate: new URL("./l1-genesis-isthmus.json.gz", import.meta.url),
    l2GenesisTemplate: new URL("./l2-genesis-isthmus.json.gz", import.meta.url),
    rollupTemplate: new URL("./rollup-isthmus.json.gz", import.meta.url),
    l1StateRoot: fromHex("290a1f5d12d900e774adb88a5af1ab2851b462c39d9580dff46a255f2275a011"),
    l2StateRoot: fromHex("0787a84d20493cb07702a2c12336dbae84fc4e57ffd369310ba0279e11c73f66"),
    l2WithdrawalsRoot: fromHex("8ed4baae3a927be3dea54996b4d5899f8c01e7594bf50b17dc1e741388ce3d12"),
    l2ExtraData: fromHex("00000000fa00000006"),
  },
  jovian: {
    l1GenesisTemplate: new URL("./l1-genesis-jovian.json.gz", import.meta.url),
    l2GenesisTemplate: new URL("./l2-genesis-jovian.json.gz", import.meta.url),
    rollupTemplate: new URL("./rollup-jovian.json.gz", import.meta.url),
    l1StateRoot: fromHex("573c114a9512aac45427b716cb80c16df579071a56391d68b17ffc217d1a3618"),
    l2StateRoot: fromHex("806020fb67bcc530c2e64024d7a46573becacdc62b18abfef93aa39093998da7"),
    l2WithdrawalsRoot: fromHex("8ed4baae3a927be3dea54996b4d5899f8c01e7594bf50b17dc1e741388ce3d12"),
    l2ExtraData: fromHex("01000000fa000000060000000000000000"),
  },
  // Karst (OP Upgrade 19) is Osaka EIPs + EVM rule changes gated on `karstTime` —
  // none of which touch the genesis alloc. There's no op-deployer release that
  // mints a karst genesis yet, so we run karst's rules on jovian's contract set:
  // reuse jovian's templates + constants and flip on karstTime/karst_time. The
  // Karst-era clients (op-reth v2.3.3 + op-node v1.19.1, selected by the recipe)
  // then execute with Osaka semantics from genesis. Swap in a real karst genesis
  // (new templates + constants) once op-deployer can produce one.
  karst: {
    l1GenesisTemplate: new URL("./l1-genesis-jovian.json.gz", import.meta.url),
    l2GenesisTemplate: new URL("./l2-genesis-jovian.json.gz", import.meta.url),
    rollupTemplate: new URL("./rollup-jovian.json.gz", import.meta.url),
    l1StateRoot: fromHex("573c114a9512aac45427b716cb80c16df579071a56391d68b17ffc217d1a3618"),
    l2StateRoot: fromHex("806020fb67bcc530c2e64024d7a46573becacdc62b18abfef93aa39093998da7"),
    l2WithdrawalsRoot: fromHex("8ed4baae3a927be3dea54996b4d5899f8c01e7594bf50b17dc1e741388ce3d12"),
    l2ExtraData: fromHex("01000000fa000000060000000000000000"),
    l2ConfigExtra: { karstTime: 0 },
    rollupExtra: { karst_time: 0 },
  },
};

// L1 forks decker's opstack can pair with any L2 fork. builder-playground's
// opstack is Electra-only; Fulu is decker's own addition (it just flips the CL
// config + genesis SSZ fork and enables Osaka on the EL — the L1 genesis hash is
// unchanged). Newer forks land here once the L1 clients support them.
export const L1_FORKS = ["electra", "fulu"] as const;
