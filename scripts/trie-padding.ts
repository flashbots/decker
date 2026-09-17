// trie-padding: create N fresh accounts on the EL BEFORE any block building
// (a warmup script), by sending 1-gwei transfers through the EL's own RPC so
// they land in the client's local payloads. decker's L1 genesis alloc is 12
// accounts: the state trie is a root with a dozen leaves, a shape mainnet
// never has. A builder whose root hasher is only exercised on mainnet-deep
// tries can compute wrong roots here (rbuilder-operator-reth in-process,
// 2026-09-16, ALP NOTES-rbuilder-state-root.md); ~1000 leaves give the trie
// branch nodes two to three levels deep. Bisection lever and mainnet-shape
// knob, not a fix.
//
// reth caps pending txs per sender at 16, so each round sends 16 per sender
// and waits for inclusion. 4 senders -> 64 accounts per block.
import {
  JsonRpcProvider,
  keccak256,
  toBeHex,
  Wallet,
} from "npm:ethers@^6.13.0";
import { STATIC_PREFUNDED_PRIVKEYS } from "../generators/l1/constants.ts";
import { findComponent, lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import type { Recipe, Script } from "../utils/types.ts";

export type PaddingSpec = {
  el: string; // EL container name (its "rpc" port)
  accounts: number; // fresh accounts to create; 0 = no-op
  senders?: readonly string[]; // private keys; default anvil #5..#8 (unused by contender/signproxy)
};

const DEFAULT_SENDERS = STATIC_PREFUNDED_PRIVKEYS.slice(5, 9);
const PER_SENDER_PER_ROUND = 16; // reth txpool max_account_slots
const RPC_PORT = "rpc";

function resolveRpcUrl(recipe: Recipe, name: string): string {
  const loc = findComponent(recipe, name);
  if (loc.kind !== "container") {
    throw new Error(`trie-padding: ${name} is not a container`);
  }
  const proto = lookup(loc.def.prototype);
  const portSpec =
    (loc.def.config?.ports as Record<string, unknown> | undefined)
      ?.[RPC_PORT] ??
      proto.ports[RPC_PORT];
  if (portSpec === undefined) {
    throw new Error(`trie-padding: ${name} has no port ${RPC_PORT}`);
  }
  // DECKER_SERVICE_HOSTS=1: containers are reachable by name (k8s Services,
  // as in ALP's in-cluster warmup Job); default is the local port-forward flow.
  const host = Deno.env.get("DECKER_SERVICE_HOSTS") === "1"
    ? name
    : "localhost";
  return `http://${host}:${portNum(portSpec as Parameters<typeof portNum>[0])}`;
}

async function waitForChain(
  provider: JsonRpcProvider,
  deadlineMs: number,
): Promise<void> {
  while (true) {
    try {
      if ((await provider.getBlockNumber()) >= 1) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadlineMs) {
      throw new Error("trie-padding: EL never produced block 1");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function triePadding(spec: PaddingSpec): Script {
  const run: Script = async (recipe: Recipe) => {
    if (spec.accounts <= 0) return;
    const url = resolveRpcUrl(recipe, spec.el);
    const provider = new JsonRpcProvider(url, undefined, {
      staticNetwork: true,
      polling: true,
    });
    await waitForChain(provider, Date.now() + 10 * 60_000);
    const chainId = (await provider.getNetwork()).chainId;
    const senders = (spec.senders ?? DEFAULT_SENDERS).map((k) =>
      new Wallet(k, provider)
    );
    let created = 0;
    let round = 0;
    while (created < spec.accounts) {
      const expect = new Map<string, number>();
      for (const w of senders) {
        if (created >= spec.accounts) break;
        const nonce = await provider.getTransactionCount(w.address, "latest");
        let sent = 0;
        for (
          ;
          sent < PER_SENDER_PER_ROUND && created < spec.accounts;
          sent++, created++
        ) {
          // deterministic fresh address: keccak(index) -> 20 bytes; nobody holds its key
          const to = "0x" + keccak256(toBeHex(created, 32)).slice(26);
          const raw = await w.signTransaction({
            type: 2,
            chainId,
            to,
            value: 1_000_000_000n,
            nonce: nonce + sent,
            gasLimit: 21_000n,
            maxFeePerGas: 10_000_000_000n,
            maxPriorityFeePerGas: 1_000_000_000n,
          });
          await provider.send("eth_sendRawTransaction", [raw]);
        }
        expect.set(w.address, nonce + sent);
      }
      // wait for this round to land (one block normally)
      const deadline = Date.now() + 120_000;
      for (const [addr, want] of expect) {
        while ((await provider.getTransactionCount(addr, "latest")) < want) {
          if (Date.now() > deadline) {
            throw new Error(
              `trie-padding: round ${round} not included in 120s`,
            );
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      round++;
    }
    console.log(
      `trie-padding: created ${created} accounts in ${round} rounds via ${url}`,
    );
  };
  Object.defineProperty(run, "name", { value: "trie-padding" });
  return run;
}
