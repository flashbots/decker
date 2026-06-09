// Port of builder-playground's `test` command. Sends a test tx to a target
// RPC (typically a builder), polls an EL RPC for the receipt, optionally
// asserts the produced block's extraData. Every request also carries an
// X-BuilderNet-Signature header (EIP-191 over keccak256(body)) so the same
// command works against FlowProxy-style endpoints.

import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import {
  type AddressLike,
  getBytes,
  keccak256,
  toUtf8String,
  Transaction,
  Wallet,
} from "npm:ethers@^6.13.0";

const STATIC_PREFUNDED = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
];

const DEFAULT_VALUE_WEI = 100_000_000_000_000_000n; // 0.1 ETH
const DEFAULT_GAS_LIMIT = 21000n;
const DEFAULT_GAS_PRICE = 1_000_000_000n; // 1 gwei

function hhmmss(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function signBuilderNetHeader(wallet: Wallet, body: string): Promise<string> {
  const bodyHash = keccak256(new TextEncoder().encode(body));
  const sig = await wallet.signMessage(bodyHash);
  return `${wallet.address}:${sig}`;
}

type RpcClient = {
  call<T>(method: string, params: unknown[]): Promise<T>;
};

function makeClient(url: string, wallet: Wallet): RpcClient {
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

async function chainId(c: RpcClient): Promise<bigint> {
  return BigInt(await c.call<string>("eth_chainId", []));
}

async function pendingNonce(c: RpcClient, addr: AddressLike): Promise<number> {
  return parseInt(await c.call<string>("eth_getTransactionCount", [addr, "pending"]), 16);
}

async function sendRawTx(c: RpcClient, raw: string): Promise<string> {
  return await c.call<string>("eth_sendRawTransaction", [raw]);
}

type Receipt = {
  blockNumber: string;
  gasUsed: string;
  status: string;
};

async function getReceipt(c: RpcClient, hash: string): Promise<Receipt | null> {
  return await c.call<Receipt | null>("eth_getTransactionReceipt", [hash]);
}

async function getBlockExtraData(c: RpcClient, blockNumberHex: string): Promise<string> {
  const block = await c.call<{ extraData: string } | null>(
    "eth_getBlockByNumber",
    [blockNumberHex, false],
  );
  return block?.extraData ?? "0x";
}

export type TestOpts = {
  rpc: string;
  elRpc: string;
  timeoutMs: number; // 0 = no timeout
  retries: number; // 0 = retry forever
  insecure: boolean;
  expectedExtraData?: string;
};

export async function runTest(opts: TestOpts): Promise<number> {
  const elRpcUrl = opts.elRpc || opts.rpc;
  const wallet = new Wallet(STATIC_PREFUNDED[1]);
  const toAddress = new Wallet(STATIC_PREFUNDED[0]).address;

  if (opts.insecure) console.warn("note: --insecure is a no-op on Deno; set DENO_CERT to trust a self-signed CA");

  const target = makeClient(opts.rpc, wallet);
  const el = opts.rpc === elRpcUrl ? target : makeClient(elRpcUrl, wallet);

  const cid = await chainId(el);
  console.log(`Chain ID: ${cid}`);

  const nonce = await pendingNonce(el, wallet.address);
  console.log(`Nonce: ${nonce}`);

  const tx = Transaction.from({
    type: 0,
    to: toAddress,
    value: DEFAULT_VALUE_WEI,
    gasLimit: DEFAULT_GAS_LIMIT,
    gasPrice: DEFAULT_GAS_PRICE,
    nonce,
    chainId: cid,
    data: "0x",
  });
  const signed = await wallet.signTransaction(tx);

  console.log(`Sending transaction at ${hhmmss(new Date())}`);
  const txHash = await sendRawTx(target, signed);
  console.log(`TX Hash: ${txHash}`);

  console.log("Waiting for receipt...");
  const deadline = opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : Infinity;
  let attempts = 0;

  while (true) {
    if (Date.now() >= deadline) {
      console.error(`timeout waiting for transaction receipt after ${opts.timeoutMs}ms`);
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
      console.log("Receipt received!");
      console.log(`  Block Number: ${blockNumber}`);
      console.log(`  Gas Used: ${gasUsed}`);
      console.log(`  Status: ${status}`);

      const extraHex = await getBlockExtraData(el, receipt.blockNumber);
      const extraStr = toUtf8String(getBytes(extraHex));
      console.log(`  Extra Data: ${extraStr}`);

      if (opts.expectedExtraData !== undefined && opts.expectedExtraData !== "") {
        if (extraStr !== opts.expectedExtraData) {
          console.log("  Extra Data check: failed");
          console.error(`extra data mismatch: expected ${JSON.stringify(opts.expectedExtraData)}`);
          return 1;
        }
        console.log("  Extra Data check: passed");
      }
      return 0;
    }

    attempts++;
    if (opts.retries > 0 && attempts >= opts.retries) {
      console.error(`failed to get transaction receipt after ${opts.retries} attempts`);
      return 1;
    }
  }
}

export const command = new Command()
  .description("Send a test transaction to the local EL node")
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
  .action(async (opts) => {
    Deno.exit(await runTest({
      rpc: opts.rpc,
      elRpc: opts.elRpc,
      timeoutMs: parseDuration(opts.timeout),
      retries: opts.retries,
      insecure: opts.insecure,
      expectedExtraData: opts.expectedExtraData,
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
