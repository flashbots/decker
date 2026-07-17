// Computes the L2 (OP-stack) genesis block hash = keccak256(RLP(header)). Same
// 21-field post-Prague header layout as the L1 header (see ../l1/el-block-hash.ts)
// with OP-specific constants; only three fields vary between L2 forks (state
// root, withdrawals root, extraData) and only the timestamp varies per run. The
// header field *set* has been identical across isthmus and jovian, so the fork
// only changes those three values, passed in from forks.ts.

import { keccak_256 } from "npm:@noble/hashes@^1.4.0/sha3";
import { RLP } from "npm:@ethereumjs/rlp@^10.0.0";

const fromHex = (h: string): Uint8Array => {
  if (h.startsWith("0x")) h = h.slice(2);
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const uint = (n: number | bigint): Uint8Array => {
  const bi = typeof n === "bigint" ? n : BigInt(n);
  if (bi === 0n) return new Uint8Array(0);
  let h = bi.toString(16);
  if (h.length % 2) h = "0" + h;
  return fromHex(h);
};

const EMPTY_UNCLE_HASH = fromHex("1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347");
const EMPTY_TRIE_ROOT = fromHex("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");
const EMPTY_REQUESTS_HASH = fromHex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const ZERO32 = new Uint8Array(32);
const ZERO8 = new Uint8Array(8);
const ZERO_LOGS_BLOOM = new Uint8Array(256);

const FEE_VAULT_COINBASE = fromHex("4200000000000000000000000000000000000011");
const GAS_LIMIT = 0x3938700; // 60_000_000
const BASE_FEE_WEI = 1_000_000_000;

export type OpHeaderParts = {
  stateRoot: Uint8Array;
  // Isthmus+: the L2ToL1MessagePasser storage root, not the withdrawals-list root.
  withdrawalsRoot: Uint8Array;
  // Holocene EIP-1559 params (fork-versioned: isthmus is 9 bytes, jovian 17).
  extraData: Uint8Array;
};

export function computeOpGenesisHash(timestampSeconds: number, parts: OpHeaderParts): Uint8Array {
  const header = [
    ZERO32, // parentHash
    EMPTY_UNCLE_HASH, // sha3Uncles
    FEE_VAULT_COINBASE, // beneficiary
    parts.stateRoot, // stateRoot
    EMPTY_TRIE_ROOT, // transactionsRoot
    EMPTY_TRIE_ROOT, // receiptsRoot
    ZERO_LOGS_BLOOM, // logsBloom
    uint(0), // difficulty (post-merge)
    uint(0), // number
    uint(GAS_LIMIT), // gasLimit
    uint(0), // gasUsed
    uint(timestampSeconds), // timestamp (the only run-variable field)
    parts.extraData, // extraData
    ZERO32, // mixHash / prevRandao
    ZERO8, // nonce
    uint(BASE_FEE_WEI), // baseFeePerGas
    parts.withdrawalsRoot, // withdrawalsRoot (Isthmus: message-passer storage root)
    uint(0), // blobGasUsed
    uint(0), // excessBlobGas
    ZERO32, // parentBeaconBlockRoot
    EMPTY_REQUESTS_HASH, // requestsHash
  ];
  return keccak_256(RLP.encode(header));
}
