import { ssz } from "npm:@lodestar/types@^1.30.0";
import { sha256 } from "npm:@noble/hashes@^1.4.0/sha2";
import { loadBlsKeys } from "./bls-keys.ts";
import { computeElGenesisHash } from "./el-block-hash.ts";
import syncCommitteeData from "./sync-committee.json" with { type: "json" };

const fromHex = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const GENESIS_VALIDATORS_ROOT = fromHex("9624293efb019b5252a8be86736907ef1cd263cefc17f4e10bcf7e266d42f02d");
const DENEB_FORK_VERSION = fromHex("20000093");
const ELECTRA_FORK_VERSION = fromHex("20000094");
const FULU_FORK_VERSION = fromHex("20000095");
const EL_STATE_ROOT = fromHex("48231728167f36a5cf6e8af0e95718a6f3f214a59a43d0d9b30f82a3013c8ba1");
const EMPTY_TRIE_ROOT = fromHex("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");

const EFFECTIVE_BALANCE = 32_000_000_000;
const GAS_LIMIT = 60_000_000;
const BASE_FEE_PER_GAS = 1_000_000_000n;
const EPOCHS_PER_HISTORICAL_VECTOR = 65536;
const DEPOSIT_CONTRACT_TREE_DEPTH = 32;
const UNSET_DEPOSIT_REQUESTS_START_INDEX = 18446744073709551615n;

function emptyDepositRoot(): Uint8Array {
  let zero: Uint8Array = new Uint8Array(32);
  for (let i = 0; i < DEPOSIT_CONTRACT_TREE_DEPTH; i++) {
    const pair = new Uint8Array(64);
    pair.set(zero, 0);
    pair.set(zero, 32);
    zero = sha256(pair);
  }
  return sha256(new Uint8Array([...zero, ...new Uint8Array(32)]));
}

export type GenesisSszOpts = {
  genesisTimeSeconds: number;
  fork: string;
};

export async function renderGenesisSsz(opts: GenesisSszOpts): Promise<Uint8Array> {
  const blsKeys = await loadBlsKeys();
  const elHash = computeElGenesisHash(opts.genesisTimeSeconds);

  const sszFork = opts.fork === "fulu" ? ssz.fulu : ssz.electra;
  const state = sszFork.BeaconState.defaultValue();

  state.genesisTime = opts.genesisTimeSeconds;
  state.genesisValidatorsRoot = GENESIS_VALIDATORS_ROOT;

  state.fork.previousVersion = opts.fork === "fulu" ? ELECTRA_FORK_VERSION : DENEB_FORK_VERSION;
  state.fork.currentVersion = opts.fork === "fulu" ? FULU_FORK_VERSION : ELECTRA_FORK_VERSION;

  state.latestBlockHeader.bodyRoot = sszFork.BeaconBlockBody.hashTreeRoot(
    sszFork.BeaconBlockBody.defaultValue(),
  );

  state.eth1Data.depositRoot = emptyDepositRoot();
  state.eth1Data.blockHash = elHash;

  for (const k of blsKeys) {
    const pubkey = fromHex(k.pub);
    const wd = new Uint8Array(32);
    wd[0] = 0x01;
    wd.set(pubkey.slice(0, 20), 12);
    state.validators.push({
      pubkey,
      withdrawalCredentials: wd,
      effectiveBalance: EFFECTIVE_BALANCE,
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: Infinity,
      withdrawableEpoch: Infinity,
    });
    state.balances.push(EFFECTIVE_BALANCE);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
    state.inactivityScores.push(0);
  }

  for (let i = 0; i < EPOCHS_PER_HISTORICAL_VECTOR; i++) {
    state.randaoMixes[i] = elHash;
  }

  const syncPubkeys = syncCommitteeData.pubkeys.map(fromHex);
  const syncAggregate = fromHex(syncCommitteeData.aggregatePubkey);
  state.currentSyncCommittee.pubkeys = syncPubkeys;
  state.currentSyncCommittee.aggregatePubkey = syncAggregate;
  state.nextSyncCommittee.pubkeys = syncPubkeys;
  state.nextSyncCommittee.aggregatePubkey = syncAggregate;

  const eph = state.latestExecutionPayloadHeader;
  eph.stateRoot = EL_STATE_ROOT;
  eph.receiptsRoot = EMPTY_TRIE_ROOT;
  eph.gasLimit = GAS_LIMIT;
  eph.timestamp = opts.genesisTimeSeconds;
  eph.baseFeePerGas = BASE_FEE_PER_GAS;
  eph.blockHash = elHash;
  eph.transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot([]);
  eph.withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot([]);

  state.depositRequestsStartIndex = UNSET_DEPOSIT_REQUESTS_START_INDEX;

  return opts.fork === "fulu"
    ? ssz.fulu.BeaconState.serialize(state as ReturnType<typeof ssz.fulu.BeaconState.defaultValue>)
    : ssz.electra.BeaconState.serialize(state);
}
