# OP-stack artifact generator

_(Ported from builder-playground's `opstack` recipe.)_

Produces the artifacts to boot an OP stack: an L1 (with the OP system contracts
predeployed) plus the L2 genesis and rollup config. Consumed by the
[opstack recipe](../../recipes/opstack.ts) — reth + lighthouse (L1), op-geth +
op-node + op-batcher (L2).

Entry: [index.ts](index.ts) `generate({outDir, l1Fork?, l2Fork?, blockTimeSeconds?, genesisDelaySeconds?})`.

## Fork matrix

The L1 consensus fork and the L2 OP fork are chosen independently:

- **l1Fork** ∈ `{electra, fulu}` — only changes the CL config (`FULU_FORK_EPOCH`),
  the genesis SSZ fork (`ssz.electra` vs `ssz.fulu`), and whether the EL genesis
  sets `osakaTime`. It does **not** change the L1 genesis block hash / state root
  (verified: enabling Osaka leaves both unchanged).
- **l2Fork** ∈ `{isthmus, jovian, karst}` — picks the templates + baked constants
  in [forks.ts](forks.ts). isthmus/jovian each have their own op-deployer output
  (different `L1StateDump`, so even the **L1 state root is L2-fork-specific**);
  karst reuses jovian's (see below).

Verified: isthmus/jovian artifacts hash-match op-geth's `ToBlock()` for every
electra/fulu combination; `fulu`+`jovian` and `fulu`+`karst` boot and sequence
live.

### Karst

Karst (OP Upgrade 19) is Osaka EIPs + EVM rule changes gated on `karstTime` —
**none touch the genesis alloc**. No op-deployer release mints a karst genesis
yet, so karst reuses jovian's op-deployer output (templates + constants) and just
flips on `karstTime`/`karst_time` via `l2ConfigExtra`/`rollupExtra`. Since the
alloc is unchanged, jovian's genesis block hash holds — verified: op-reth's block
0 matches our `rollup.json`, so op-node starts, and the P256VERIFY precompile
(EIP-7951, karst-only) answers on the running chain.

Caveat: this is karst *rules* on jovian's *contracts* — it does not include the
L2CM predeploy or the op-contracts-v7 L1 set a mainnet karst genesis would have.
Swap in a real karst genesis (its own templates + constants, derived from a
running op-reth's block 0) once op-deployer can produce one; the `forks.ts` entry
is the only thing that changes.

### L2 execution client by fork

Karst (OP Upgrade 19, July 2026) ends op-geth support: from Karst on, the L2 EL
is **op-reth** and op-node needs a newer release. The [recipe](../../recipes/opstack.ts)
switches the L2 client set by fork tier — `{isthmus, jovian}` → op-geth +
op-node `v1.16.3`; Karst-and-beyond → [op-reth](../../containers/op-reth.ts)
`v2.3.3` + op-node `v1.19.1`. That op-reth + op-node-v1.19.1 client stack is
verified to boot and sequence live.

## Relationship to the l1 generator

The L1 CL side is identical to [../l1](../l1), so this generator **reuses** l1's
`cl-config.ts`, `bls-keys.ts`, `validator-keystores.ts`, `genesis-ssz.ts`, and
`el-block-hash.ts`. The two things that differ:

1. The L1 genesis alloc has the OP system contracts merged in → a different state
   root (`forks.ts` `l1StateRoot`). Both `computeElGenesisHash` and
   `renderGenesisSsz` take that root as a parameter.
2. There are extra L2 files: `l2-genesis.json` and `rollup.json`.

## Run-variable inputs

Only `genesisTimeSeconds = floor(now/1000) + delay` varies per run. The L2
genesis starts `OP_TIMESTAMP_OFFSET_SECONDS` (2s) later. Everything else is a
baked constant or a deterministic function of the timestamp:

- `genesisTimeSeconds` → L1 `genesis.json` `{timestamp, config.{shanghai,cancun,prague[,osaka]}Time}`
- `genesisTimeSeconds` + fork `l1StateRoot` → L1 genesis block hash → `genesis.ssz` + `rollup.json.genesis.l1.hash`
- `genesisTimeSeconds + 2` → L2 `l2-genesis.json.timestamp`
- `genesisTimeSeconds + 2` → L2 genesis block hash (`op-block-hash.ts`) → `rollup.json.genesis.l2.hash`

## Files

Code:
- [index.ts](index.ts) — orchestrator. Validates the forks, then writes the L1 CL/EL files (reusing l1) and the two L2 files.
- [forks.ts](forks.ts) — the fork registry: per-L2-fork templates + baked constants; the L1 fork list.
- [constants.ts](constants.ts) — fork-independent constants (just `OP_TIMESTAMP_OFFSET_SECONDS`).
- [l1-genesis.ts](l1-genesis.ts) — patches time fields into the L1 template (sets `osakaTime` for fulu).
- [l2-genesis.ts](l2-genesis.ts) — patches the timestamp into the L2 template.
- [rollup.ts](rollup.ts) — patches the two genesis hashes + `l2_time` into the rollup template.
- [op-block-hash.ts](op-block-hash.ts) — RLP-encodes the 21-field L2 genesis header (state root / withdrawals root / extraData come from the fork).

Vendored templates per L2 fork (from a reference `builder-playground start opstack [--enable-latest-fork 0] --dry-run`, time fields zeroed):
- `l1-genesis-<fork>.json` — full L1 genesis.json with that fork's OP contracts in the alloc.
- `l2-genesis-<fork>.json` — full L2 genesis.json (predeploys + prefunded accounts).
- `rollup-<fork>.json` — rollup.json with the run-variable hashes/`l2_time` zeroed.

## Invariants

- **EL/CL hash agreement (L1).** The fork's `l1StateRoot` must be the root the L1
  EL computes for the OP-augmented alloc; it feeds both the EL genesis block hash
  and `genesis.ssz`'s execution payload header. If they disagree the chain never
  advances.
- **op-node genesis anchors.** `rollup.json.genesis.l1.hash` / `l2.hash` must
  equal what reth / op-geth compute for block 0. op-node refuses to start on a
  mismatch. This is why the op-geth image is pinned to the exact version the
  constants were derived from (`v1.101604.0`).
- **Isthmus+ withdrawalsRoot.** At genesis the L2 block's `withdrawalsRoot` is the
  storage root of the L2ToL1MessagePasser predeploy (fork `l2WithdrawalsRoot`),
  not the empty-trie root.

## Adding a fork / regenerating constants

Everything below is derived together from a reference run; regenerate as a set.

**New L2 fork** (e.g. karst):
1. `builder-playground start opstack --enable-latest-fork 0 --output <dir> --dry-run`
   (or whatever flag the newer builder-playground uses) to emit reference
   `genesis.json`, `l2-genesis.json`, `rollup.json`.
2. Vendor the three templates (zero the per-run time fields — L1: `timestamp` +
   `config.{shanghai,cancun,prague}Time`; L2: `timestamp`; rollup: `genesis.l1.hash`,
   `genesis.l2.hash`, `genesis.l2_time`).
3. Capture, for both genesis blocks, the `stateRoot` and the L2 block's
   `withdrawalsRoot` + `extraData`, then add a `forks.ts` entry. For op-geth-era
   forks use `core.Genesis.ToBlock()` (a throwaway `go run` in builder-playground);
   for Karst+ op-geth can't (it doesn't know `karstTime`) — read them from a
   running op-reth's block 0, or op-reth's genesis tooling.
4. Client set: the recipe already routes Karst+ to op-reth + op-node `v1.19.1`
   (see its `OP_GETH_FORKS` set). Only touch it if a fork needs a newer image tag.
5. Verify: regenerate with a pinned `genesisTimeSeconds` and confirm the L1/L2
   block hashes match op-geth's `ToBlock()` for the same genesis files (both at
   the reference timestamp and an arbitrary one); then boot it.

**New L1 fork** (beyond fulu): extend `L1_FORKS`, handle its EL time field in
`l1-genesis.ts`, and confirm it doesn't change the L1 genesis hash (or capture a
new per-fork root if it does).

## Hardcoded assumptions

- Prefunded accounts = the 10 hardhat defaults only, in both allocs. Custom allocs change the state roots.
- L2 header shape = 21 fields (has held across isthmus and jovian; only state root / withdrawals root / extraData vary). A fork that adds a header field needs `op-block-hash.ts` updated.
