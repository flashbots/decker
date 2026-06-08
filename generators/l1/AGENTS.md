# L1 artifact generator

_(Ported from builder-playground)_

Produces every file a CL + EL + validator + relay stack needs to boot a fresh Electra L1 testnet from genesis.

Entry: [index.ts](index.ts) `generate({outDir, blockTimeSeconds?, genesisDelaySeconds?})`.

## Run-variable inputs

Only `genesisTimeSeconds = floor(now/1000) + delay` varies per run. Every other byte in every output file is either a baked constant or a deterministic function of `genesisTimeSeconds`. This is why the implementation is small — most surface is vendored, not computed.

Propagation:
- `genesisTimeSeconds` → `genesis.json` `{timestamp, config.{shanghai,cancun,prague}Time}`
- `genesisTimeSeconds` → `el-block-hash.ts` `computeElGenesisHash()` → 32-byte EL hash
- EL hash → `genesis.ssz` `{eth1Data.blockHash, latestExecutionPayloadHeader.blockHash}`
- `genesisTimeSeconds` → `genesis.ssz` `{genesisTime, latestExecutionPayloadHeader.timestamp}`

## Files

Code:
- [index.ts](index.ts) — orchestrator. Writes 5 trivial constant files + dispatches to renderers.
- [constants.ts](constants.ts) — `JWT_SECRET`, `KEYSTORE_SECRET="secret"`, `STATIC_PREFUNDED_PRIVKEYS` (10 Hardhat keys), `DEPOSIT_CONTRACT_ADDRESS=0x4242…`, `MIN_GENESIS_DELAY_SECONDS=10`, `DEFAULT_L1_BLOCK_TIME_SECONDS=12`.
- [cl-config.ts](cl-config.ts) — regex-substitutes `SECONDS_PER_SLOT` and `SLOT_DURATION_MS` in the YAML template.
- [el-genesis.ts](el-genesis.ts) — `JSON.parse` template, set 4 time fields, `JSON.stringify` with tab indent.
- [el-block-hash.ts](el-block-hash.ts) — RLP-encodes 21-field post-Pectra header (20 constants + timestamp), keccak256. Output must equal what reth computes for block 0.
- [bls-keys.ts](bls-keys.ts) — loads + caches `bls_keys.json` as `{priv, pub, keystore}[]`.
- [validator-keystores.ts](validator-keystores.ts) — writes `data_validator/validators/0x<pub>/voting-keystore.json` and `data_validator/secrets/0x<pub>` with content `KEYSTORE_SECRET`.
- [genesis-ssz.ts](genesis-ssz.ts) — builds an Electra `BeaconState` from `defaultValue()` + the BLS fixture + the EL hash, then `.serialize`. Uses `@lodestar/types` + `@noble/hashes`.

Vendored fixtures (regenerate via a reference Electra-only L1 run):
- `bls_keys.json` — 100 pre-encrypted v4 keystores. Size fixes validator count and `GENESIS_VALIDATORS_ROOT_HEX`.
- `cl-config-template.yaml` — Electra-active, Fulu-disabled. Captures Prysm's expanded YAML form of `BeaconConfig`, not its input.
- `el-genesis-template.json` — full genesis.json with `{shanghai,cancun,prague}Time` and top-level `timestamp` zeroed. No `osakaTime` — Osaka is the EL Fulu counterpart and stays disabled.
- `sync-committee.json` — 512 pubkeys + 1 aggregate pubkey (~50 KB) for the genesis sync committee. Vendored because recomputing requires the spec's shuffle algorithm + BLS aggregation. Both `current_sync_committee` and `next_sync_committee` use this same set at genesis. See "Precomputed shortcuts" below.

## Invariants not visible in code

- **EL/CL hash agreement.** `el-block-hash.ts` output must equal `latestExecutionPayloadHeader.blockHash` in the SSZ state for the same timestamp. If reth and the CL disagree on block 0's hash, the chain never advances.
- **`GENESIS_VALIDATORS_ROOT_HEX` is constant.** It's a Merkle root over the validator list, which is fixed by the BLS fixture. Hex `9624293efb019b5252a8be86736907ef1cd263cefc17f4e10bcf7e266d42f02d`. Regenerating the BLS fixture invalidates this.
- **Electra-only.** Moving to Fulu would require switching to `ssz.fulu.BeaconState` + sourcing Fulu-only fields and regenerating `cl-config-template.yaml` in Fulu mode.
- **Validator withdrawal credentials** use type-0x01 form: `0x01 || zero(11) || pubkey[0:20]` — first 20 bytes of each BLS pubkey become the validator's withdrawal "execution address". Not the standard BLS withdrawal form.

## Precomputed shortcuts

Two values that the spec defines as functions of the validator list are stored as constants instead of recomputed per run. Both depend only on the (fixed) BLS fixture, so they never change between runs:

- `sync-committee.json` — genesis sync committee pubkeys + aggregate. The spec derivation requires the shuffle algorithm + BLS aggregation; we skip both.
- `GENESIS_VALIDATORS_ROOT_HEX` in [index.ts](index.ts) — Merkle root over the validator list. Skips an SSZ hash-tree-root call.

Regenerating `bls_keys.json` invalidates both. They must be regenerated together.

## Hardcoded assumptions

- Validator count = 100 (BLS fixture size).
- Prefunded accounts = 10 Hardhat defaults only. Custom `alloc` requires mutating `genesis.json` and recomputing the EL hash.
- Post-Pectra EL header shape (21 fields). Enabling Osaka would change this.
