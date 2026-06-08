// Computes the EL genesis block hash = keccak256(RLP(header)).
// The block header has 21 fields (post-Pectra). For our recipe the alloc is
// constant — only the timestamp changes per run — so every header field
// except `timestamp` is a baked constant.

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
const STATE_ROOT = fromHex("48231728167f36a5cf6e8af0e95718a6f3f214a59a43d0d9b30f82a3013c8ba1");
const ZERO32 = new Uint8Array(32);
const ZERO20 = new Uint8Array(20);
const ZERO8 = new Uint8Array(8);
const ZERO_LOGS_BLOOM = new Uint8Array(256);

const GAS_LIMIT = 0x3938700; // 60_000_000 (matches genesis.json)
const DIFFICULTY = 1;
const BASE_FEE_WEI = 1_000_000_000; // London default for genesis

export function computeElGenesisHash(timestampSeconds: number): Uint8Array {
  const header = [
    ZERO32, // parentHash
    EMPTY_UNCLE_HASH, // sha3Uncles
    ZERO20, // beneficiary
    STATE_ROOT, // stateRoot
    EMPTY_TRIE_ROOT, // transactionsRoot
    EMPTY_TRIE_ROOT, // receiptsRoot
    ZERO_LOGS_BLOOM, // logsBloom
    uint(DIFFICULTY), // difficulty
    uint(0), // number
    uint(GAS_LIMIT), // gasLimit
    uint(0), // gasUsed
    uint(timestampSeconds), // timestamp (the only run-variable field)
    new Uint8Array(0), // extraData
    ZERO32, // mixHash
    ZERO8, // nonce
    uint(BASE_FEE_WEI), // baseFeePerGas
    EMPTY_TRIE_ROOT, // withdrawalsRoot
    uint(0), // blobGasUsed
    uint(0), // excessBlobGas
    ZERO32, // parentBeaconBlockRoot
    EMPTY_REQUESTS_HASH, // requestsHash
  ];
  return keccak_256(RLP.encode(header));
}
