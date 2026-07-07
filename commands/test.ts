// Port of builder-playground's `test` command. Sends a test tx to a target
// RPC (typically a builder), polls an EL RPC for the receipt, optionally
// asserts the produced block's extraData. Every request also carries an
// X-BuilderNet-Signature header (EIP-191 over keccak256(body)) so the same
// command works against FlowProxy-style endpoints.

import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import {
  type AddressLike,
  concat,
  decodeRlp,
  encodeRlp,
  getBytes,
  hexlify,
  keccak256,
  sha256,
  toUtf8String,
  Transaction,
  Wallet,
} from "npm:ethers@^6.13.0";
import { accent, dim, err, success, warn } from "../utils/term.ts";

export const STATIC_PREFUNDED = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
];

export type TxType = "legacy" | "blob";

const DEFAULT_VALUE_WEI = 100_000_000_000_000_000n; // 0.1 ETH
const DEFAULT_GAS_LIMIT = 21000n;
const DEFAULT_GAS_PRICE = 1_000_000_000n; // 1 gwei
// EIP-1559/blob fee fields (blob tx is type 3, so it can't use gasPrice).
const DEFAULT_PRIORITY_FEE = 1_000_000_000n; // 1 gwei
const DEFAULT_MAX_FEE = 10_000_000_000n; // 10 gwei — covers devnet base fee
const DEFAULT_MAX_BLOB_FEE = 1_000_000_000n; // 1 gwei — well above the 1 wei min

const BLOB_SIZE = 4096 * 32; // one EIP-4844 blob: 4096 field elements × 32 bytes

// kzg-wasm, loaded lazily so the legacy path never pays for the WASM init. Its
// trusted setup is network-agnostic, so the bundled mainnet setup is correct on
// any devnet. v1 exposes the EIP-7594 cell-proof ops required post-Osaka.
type KzgApi = {
  blobToKZGCommitment: (blob: string) => string;
  computeCellsAndProofs: (blob: string) => [string[], string[]];
};
let kzgLib: Promise<KzgApi> | null = null;
function getKzg(): Promise<KzgApi> {
  if (!kzgLib) {
    kzgLib = import("npm:kzg-wasm@^1.0.0").then((m) => m.loadKZG() as Promise<KzgApi>);
  }
  return kzgLib;
}

const hx = (s: string): string => (s.startsWith("0x") ? s : `0x${s}`);

// A single valid blob: a short marker in the first field element (leading byte
// left 0 so the element stays below the BLS modulus), the rest zero-filled.
function makeBlob(marker: string): Uint8Array {
  const blob = new Uint8Array(BLOB_SIZE);
  blob.set(new TextEncoder().encode(marker).subarray(0, 31), 1);
  return blob;
}

// versioned hash = 0x01 ‖ sha256(commitment)[1:]  (VERSIONED_HASH_VERSION_KZG)
function blobVersionedHash(commitment: string): string {
  const h = getBytes(sha256(hx(commitment)));
  h[0] = 0x01;
  return hexlify(h);
}

// Build a post-Osaka (EIP-7594/PeerDAS) blob tx. ethers only serializes the
// legacy EIP-4844 sidecar, so we let it produce the signed canonical tx
// (0x03 ‖ rlp(body)) and re-wrap it as the cell-proof network form it can't
// emit:  0x03 ‖ rlp([body, wrapper_version=1, blobs, commitments, cell_proofs])
async function signBlobTx(wallet: Wallet, to: string, nonce: number, cid: bigint): Promise<string> {
  const kzg = await getKzg();
  const blob = hexlify(makeBlob("decker blob tx"));
  const commitment = hx(kzg.blobToKZGCommitment(blob));
  const cellProofs = kzg.computeCellsAndProofs(blob)[1].map(hx); // 128 proofs per blob

  const tx = new Transaction();
  tx.type = 3;
  tx.to = to;
  tx.value = DEFAULT_VALUE_WEI;
  tx.nonce = nonce;
  tx.chainId = cid;
  tx.gasLimit = DEFAULT_GAS_LIMIT;
  tx.maxPriorityFeePerGas = DEFAULT_PRIORITY_FEE;
  tx.maxFeePerGas = DEFAULT_MAX_FEE;
  tx.maxFeePerBlobGas = DEFAULT_MAX_BLOB_FEE;
  tx.blobVersionedHashes = [blobVersionedHash(commitment)];
  // Sign the instance directly so we keep the canonical (sidecar-free) signed tx.
  tx.signature = wallet.signingKey.sign(tx.unsignedHash);

  const body = decodeRlp(hx(tx.serialized.slice(4))); // strip 0x03, decode rlp(body)
  const wrapper = encodeRlp([body, "0x01", [blob], [commitment], cellProofs]);
  return concat(["0x03", wrapper]);
}

export async function signTx(
  type: TxType,
  wallet: Wallet,
  to: string,
  nonce: number,
  cid: bigint,
): Promise<string> {
  if (type === "blob") return await signBlobTx(wallet, to, nonce, cid);
  const tx = Transaction.from({
    type: 0,
    to,
    value: DEFAULT_VALUE_WEI,
    gasLimit: DEFAULT_GAS_LIMIT,
    gasPrice: DEFAULT_GAS_PRICE,
    nonce,
    chainId: cid,
    data: "0x",
  });
  return await wallet.signTransaction(tx);
}

function hhmmss(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function signBuilderNetHeader(wallet: Wallet, body: string): Promise<string> {
  const bodyHash = keccak256(new TextEncoder().encode(body));
  const sig = await wallet.signMessage(bodyHash);
  return `${wallet.address}:${sig}`;
}

export type RpcClient = {
  call<T>(method: string, params: unknown[]): Promise<T>;
};

export function makeClient(url: string, wallet: Wallet): RpcClient {
  let id = 0;
  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-BuilderNet-Signature": await signBuilderNetHeader(wallet, body),
      };
      const r = await fetch(url, { method: "POST", body, headers });
      if (!r.ok) throw new Error(`${method} → ${r.status} ${await r.text()}`);
      const j = await r.json();
      if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
      return j.result as T;
    },
  };
}

export async function chainId(c: RpcClient): Promise<bigint> {
  return BigInt(await c.call<string>("eth_chainId", []));
}

export async function pendingNonce(c: RpcClient, addr: AddressLike): Promise<number> {
  return parseInt(await c.call<string>("eth_getTransactionCount", [addr, "pending"]), 16);
}

export async function sendRawTx(c: RpcClient, raw: string): Promise<string> {
  return await c.call<string>("eth_sendRawTransaction", [raw]);
}

export type Receipt = {
  blockNumber: string;
  gasUsed: string;
  status: string;
};

export async function getReceipt(c: RpcClient, hash: string): Promise<Receipt | null> {
  return await c.call<Receipt | null>("eth_getTransactionReceipt", [hash]);
}

export async function getBlockExtraData(c: RpcClient, blockNumberHex: string): Promise<string> {
  const block = await c.call<{ extraData: string } | null>(
    "eth_getBlockByNumber",
    [blockNumberHex, false],
  );
  return block?.extraData ?? "0x";
}

export function tryUtf8(hex: string): string {
  try {
    return toUtf8String(getBytes(hex));
  } catch {
    return hex;
  }
}

export type TestOpts = {
  rpc: string;
  elRpc: string;
  timeoutMs: number; // 0 = no timeout
  retries: number; // 0 = retry forever
  insecure: boolean;
  expectedExtraData?: string;
  type: TxType;
};

export async function runTest(opts: TestOpts): Promise<number> {
  const elRpcUrl = opts.elRpc || opts.rpc;
  const wallet = new Wallet(STATIC_PREFUNDED[1]);
  const toAddress = new Wallet(STATIC_PREFUNDED[0]).address;

  if (opts.insecure) console.warn(warn("note: --insecure is a no-op on Deno; set DENO_CERT to trust a self-signed CA"));

  const target = makeClient(opts.rpc, wallet);
  const el = opts.rpc === elRpcUrl ? target : makeClient(elRpcUrl, wallet);

  const cid = await chainId(el);
  console.log(`${dim("Chain ID:")} ${accent(String(cid))}`);

  const nonce = await pendingNonce(el, wallet.address);
  console.log(`${dim("Nonce:")}    ${accent(String(nonce))}`);

  const signed = await signTx(opts.type, wallet, toAddress, nonce, cid);

  const label = opts.type === "blob" ? "blob transaction" : "transaction";
  console.log(`${dim(`Sending ${label} at`)} ${accent(hhmmss(new Date()))}`);
  const txHash = await sendRawTx(target, signed);
  console.log(`${dim("TX Hash:")}  ${accent(txHash)}`);

  console.log(dim("Waiting for receipt…"));
  const deadline = opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : Infinity;
  let attempts = 0;

  while (true) {
    if (Date.now() >= deadline) {
      console.error(err(`✗ timeout waiting for transaction receipt after ${opts.timeoutMs}ms`));
      return 1;
    }
    await new Promise((r) => setTimeout(r, 1000));

    let receipt: Receipt | null = null;
    try {
      receipt = await getReceipt(el, txHash);
    } catch {
      // count as a failed attempt
    }
    if (receipt) {
      const blockNumber = parseInt(receipt.blockNumber, 16);
      const gasUsed = parseInt(receipt.gasUsed, 16);
      const status = parseInt(receipt.status, 16);
      console.log(`${success("✓")} Receipt received`);
      console.log(`  ${dim("Block Number:")} ${accent(String(blockNumber))}`);
      console.log(`  ${dim("Gas Used:")}     ${accent(String(gasUsed))}`);
      console.log(`  ${dim("Status:")}       ${accent(String(status))}`);

      const extraHex = await getBlockExtraData(el, receipt.blockNumber);
      const extraStr = tryUtf8(extraHex);
      console.log(`  ${dim("Extra Data:")}   ${accent(extraStr)}`);

      if (opts.expectedExtraData !== undefined && opts.expectedExtraData !== "") {
        if (extraStr !== opts.expectedExtraData) {
          console.log(`  ${err("✗")} Extra Data check: ${err("failed")}`);
          console.error(err(`extra data mismatch: expected ${JSON.stringify(opts.expectedExtraData)}`));
          return 1;
        }
        console.log(`  ${success("✓")} Extra Data check: ${success("passed")}`);
      }
      return 0;
    }

    attempts++;
    if (opts.retries > 0 && attempts >= opts.retries) {
      console.error(err(`✗ failed to get transaction receipt after ${opts.retries} attempts`));
      return 1;
    }
  }
}

export const command = new Command()
  .description("Send a test transaction (default: http://localhost:8545)")
  .option("--rpc <url:string>", "Target RPC URL for sending transactions", {
    default: "http://localhost:8545",
  })
  .option("--el-rpc <url:string>", "EL RPC URL for chain queries (default: same as --rpc)", {
    default: "",
  })
  .option("--timeout <duration:string>", "Timeout for waiting for receipt (0 = no timeout)", {
    default: "1m",
  })
  .option("--retries <n:integer>", "Max failed receipt requests before giving up (0 = retry forever)", {
    default: 0,
  })
  .option("--insecure", "Skip TLS certificate verification (for self-signed certs)", {
    default: false,
  })
  .option("--expected-extra-data <s:string>", "Verify block extra data matches this string", {
    default: "",
  })
  .option("--type <type:string>", "Transaction type to send: legacy or blob", {
    default: "legacy",
  })
  .action(async (opts) => {
    if (opts.type !== "legacy" && opts.type !== "blob") {
      console.error(err(`unknown --type ${JSON.stringify(opts.type)} (expected: legacy, blob)`));
      Deno.exit(2);
    }
    Deno.exit(await runTest({
      rpc: opts.rpc,
      elRpc: opts.elRpc,
      timeoutMs: parseDuration(opts.timeout),
      retries: opts.retries,
      insecure: opts.insecure,
      expectedExtraData: opts.expectedExtraData,
      type: opts.type,
    }));
  });

// Accepts e.g. "1m", "30s", "500ms", "2h", or a bare integer (seconds).
function parseDuration(s: string): number {
  const m = s.match(/^(\d+)(ms|s|m|h)?$/);
  if (!m) throw new Error(`bad duration: ${s}`);
  const n = parseInt(m[1], 10);
  switch (m[2] ?? "s") {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    default: throw new Error(`bad duration unit: ${m[2]}`);
  }
}
