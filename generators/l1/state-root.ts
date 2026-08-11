// Merkle-Patricia root of a geth-style genesis alloc.
//
// The EL derives the genesis header's stateRoot from the alloc it is given; the
// CL's genesis state embeds the same root (genesis-ssz.ts) and the header hash
// built from it. The two must agree or lighthouse's first forkchoiceUpdated
// names a block reth has never seen. So once the alloc stops being fixed — an
// artifacts `alloc` predeploying a contract — the root has to be computed here
// rather than baked.
//
// The trie is built once from a static, fully-known key set, which is far less
// than a general MPT: no deletion, no updates, no node store. Keys are 32-byte
// hashes, so no key is a prefix of another and a branch never carries a value.

import { keccak_256 } from "npm:@noble/hashes@^1.4.0/sha3";
import { RLP } from "npm:@ethereumjs/rlp@^10.0.0";

// A geth genesis account. Absent fields are the zero value; `balance` and
// `nonce` accept hex ("0x…") or decimal, as geth does.
export type GenesisAccount = {
  balance?: string | number;
  nonce?: string | number;
  code?: string;
  storage?: Record<string, string>;
};

export type GenesisAlloc = Record<string, GenesisAccount>;

// keccak256(rlp("")) — the root of an empty trie.
const EMPTY_TRIE_ROOT = hexBytes("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");
const KECCAK_EMPTY = keccak_256(new Uint8Array(0));

// The RLP shape of a node: a byte string, or a list of them (branch/extension/
// leaf). Sub-32-byte children are embedded as this structure instead of a hash.
type Node = Uint8Array | Node[];

type Entry = { key: Uint8Array; value: Uint8Array };

function hexBytes(h: string): Uint8Array {
  let s = h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
  if (s.length % 2) s = "0" + s;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function toBigInt(v: string | number | undefined): bigint {
  if (v === undefined) return 0n;
  if (typeof v === "number") return BigInt(v);
  const s = v.trim();
  if (s === "") return 0n;
  return s.startsWith("0x") || s.startsWith("0X") ? BigInt(s) : BigInt(s);
}

// Big-endian, no leading zeros; zero is the empty string (RLP integer form).
function uintBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return hexBytes(h);
}

function nibbles(b: Uint8Array): number[] {
  const out = new Array<number>(b.length * 2);
  for (let i = 0; i < b.length; i++) {
    out[2 * i] = b[i] >> 4;
    out[2 * i + 1] = b[i] & 0x0f;
  }
  return out;
}

// Compact ("hex prefix") encoding of a partial path: a flag nibble carrying the
// leaf marker and the odd-length bit, then the nibbles packed in pairs.
function hexPrefix(path: number[], leaf: boolean): Uint8Array {
  const odd = path.length & 1;
  const flag = (leaf ? 2 : 0) + odd;
  const nibs = odd ? [flag, ...path] : [flag, 0, ...path];
  const out = new Uint8Array(nibs.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (nibs[2 * i] << 4) | nibs[2 * i + 1];
  return out;
}

// A child slot holds the node itself when its encoding is under 32 bytes, and
// its hash otherwise.
function ref(node: Node): Node {
  const encoded = RLP.encode(node);
  return encoded.length < 32 ? node : keccak_256(encoded);
}

function commonPrefixLen(entries: Entry[], depth: number): number {
  const first = nibbles(entries[0].key);
  let len = 0;
  for (;;) {
    const at = depth + len;
    if (at >= first.length) return len;
    const nib = first[at];
    for (let i = 1; i < entries.length; i++) {
      if (nibbles(entries[i].key)[at] !== nib) return len;
    }
    len++;
  }
}

function buildNode(entries: Entry[], depth: number): Node {
  if (entries.length === 1) {
    const path = nibbles(entries[0].key).slice(depth);
    return [hexPrefix(path, true), entries[0].value];
  }
  const shared = commonPrefixLen(entries, depth);
  if (shared > 0) {
    const path = nibbles(entries[0].key).slice(depth, depth + shared);
    return [hexPrefix(path, false), ref(buildBranch(entries, depth + shared))];
  }
  return buildBranch(entries, depth);
}

function buildBranch(entries: Entry[], depth: number): Node {
  const slots: Node[] = Array.from({ length: 17 }, () => new Uint8Array(0));
  const buckets = new Map<number, Entry[]>();
  for (const e of entries) {
    const nib = nibbles(e.key)[depth];
    const bucket = buckets.get(nib);
    if (bucket) bucket.push(e);
    else buckets.set(nib, [e]);
  }
  for (const [nib, bucket] of buckets) slots[nib] = ref(buildNode(bucket, depth + 1));
  return slots;
}

// Root of a trie over the given key/value pairs (keys already hashed).
function trieRoot(entries: Entry[]): Uint8Array {
  if (entries.length === 0) return EMPTY_TRIE_ROOT;
  const sorted = [...entries].sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    }
    return 0;
  });
  return keccak_256(RLP.encode(buildNode(sorted, 0)));
}

function storageRoot(storage: Record<string, string> | undefined): Uint8Array {
  if (!storage) return EMPTY_TRIE_ROOT;
  const entries: Entry[] = [];
  for (const [slot, value] of Object.entries(storage)) {
    const v = toBigInt(value);
    // A zero slot is not stored; it is indistinguishable from an absent one.
    if (v === 0n) continue;
    entries.push({ key: keccak_256(pad32(hexBytes(slot))), value: RLP.encode(uintBytes(v)) });
  }
  return trieRoot(entries);
}

function pad32(b: Uint8Array): Uint8Array {
  if (b.length === 32) return b;
  if (b.length > 32) throw new Error(`state-root: value longer than 32 bytes (${b.length})`);
  const out = new Uint8Array(32);
  out.set(b, 32 - b.length);
  return out;
}

// State root of a genesis alloc: keccak(address) → rlp([nonce, balance,
// storageRoot, codeHash]).
export function allocStateRoot(alloc: GenesisAlloc): Uint8Array {
  const entries: Entry[] = [];
  for (const [address, account] of Object.entries(alloc)) {
    const addr = hexBytes(address);
    if (addr.length !== 20) throw new Error(`state-root: ${address} is not a 20-byte address`);
    const code = account.code ? hexBytes(account.code) : new Uint8Array(0);
    const value = RLP.encode([
      uintBytes(toBigInt(account.nonce)),
      uintBytes(toBigInt(account.balance)),
      storageRoot(account.storage),
      code.length === 0 ? KECCAK_EMPTY : keccak_256(code),
    ]);
    entries.push({ key: keccak_256(addr), value });
  }
  return trieRoot(entries);
}
