import type { ContainerDef, ContainerResult, Ctx } from "../utils/types.ts";

// contender is a load generator — a client that drives traffic at an RPC.
// It serves nothing itself, so it declares no ports.
export const ports = {};

const DEFAULT_IMAGE = "ghcr.io/flashbots/contender:latest";
// Prefunded devnet account #1 (not rbuilder's coinbase account).
const DEFAULT_PRIV_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// config:
//   rpcUrl    (required) EL RPC for eth_ reads (nonce/balance/receipts), e.g. http://el-1:8545
//   txsUrl    optional: route eth_sendRawTransaction here instead of rpcUrl — point it
//             at the rbuilder jsonrpc (e.g. http://rbuilder-1:8745) to feed the builder's
//             order pool directly, so load isn't lost to local-fallback slots
//   scenario  built-in spam subcommand: transfers | fill-block | … (default transfers —
//             no contract deploy, so spamming starts immediately)
//   tps       txs per second (default 10)
//   duration  run length in seconds (default 10)
//   privKey   prefunded sender key — with --override-senders every tx comes from it
//   image / args  overrides
//
// --override-senders makes contender send every tx from the single prefunded
// privKey instead of generating and funding a spam-account pool — that funding
// loop is the slow part on a real-block devnet (one confirmation round per
// account at slot time). Setup then collapses to just the scenario's one-time
// contract deploy. CLI shape verified: options come before the scenario
// subcommand, which must be LAST; the scenario is built-in (no testfile needed).
export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const cfg = def.config ?? {};
  const rpcUrl = cfg.rpcUrl as string | undefined;
  if (!rpcUrl) throw new Error(`contender ${def.name}: config.rpcUrl is required`);

  const image = (cfg.image as string | undefined) ?? DEFAULT_IMAGE;
  const txsUrl = cfg.txsUrl as string | undefined;
  const scenario = (cfg.scenario as string | undefined) ?? "transfers";
  const tps = (cfg.tps as number | undefined) ?? 10;
  const duration = (cfg.duration as number | undefined) ?? 10;
  const privKey = (cfg.privKey as string | undefined) ?? DEFAULT_PRIV_KEY;
  // contender still enforces --min-balance on the sender even with
  // --override-senders; the prefunded account is already above it, so this just
  // clears the check (no funding happens). Bare number = wei, so use `eth`.
  const minBalance = (cfg.minBalance as string | undefined) ?? "1eth";

  const args = (cfg.args as string[] | undefined) ?? [
    "spam",
    "-r", rpcUrl,
    ...(txsUrl ? ["--txs-url", txsUrl] : []),
    "-p", privKey,
    "--tps", String(tps),
    "-d", String(duration),
    "--min-balance", minBalance,
    "--override-senders",
    scenario, // built-in scenario subcommand — must be last
  ];

  return { container: { image, args, ports } };
}
