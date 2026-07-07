// Smoke test for rbuilder-reth2, run as the recipe's last script on `decker up`
// (scripts run after pods AND processes are started; see commands/up.ts).
// Also runnable standalone against an already-up devnet:
//
//   deno run -A scripts/pipeline-check.ts
//
// Sends one tx through the pipeline (8545 -> rbuilder -> relay -> beacon/validator)
// and, if it doesn't end up in a builder-won block, attributes the failure to
// whichever service actually made the decision — not just whoever's upstream:
//   - el-1 crashed / never submitted -> el-1's own process state + log
//   - el-1 submitted but the relay rejected it -> the relay's own log
//   - relay delivered but the chain shows a different block -> validator-1's log

import { Wallet } from "npm:ethers@^6.13.0";
import type { Script } from "../utils/types.ts";
import {
  chainId,
  getBlockExtraData,
  getReceipt,
  makeClient,
  pendingNonce,
  sendRawTx,
  signTx,
  STATIC_PREFUNDED,
  tryUtf8,
  type TxType,
} from "../commands/test.ts";
import { accent, dim, err, success } from "../utils/term.ts";

const RPC = "http://localhost:8545";
const RELAY = "http://localhost:9062";
const EXPECTED_EXTRA_DATA = "el-1 ⚡";
const VALIDATOR_POD_LABEL = "validator-1";
const RELAY_POD_LABEL = "mev-boost-relay-1";
const EL_PROCESS_NAME = "el-1";
const READY_TIMEOUT_MS = 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;
const LOG_TAIL_LINES = 500;

// The specific, own-fault error/warn lines rbuilder logs before it would ever
// reach the relay (verified against cache/sources/rbuilder/.../relay_submit.rs;
// these are error!/warn! level so they're visible regardless of the recipe's
// "rbuilder=debug" log_level, unlike the trace!-level success/rejection lines).
const RBUILDER_ERROR_MARKERS = [
  "Error creating submit block request",
  "Error block simulation fail",
  "RPC conversion error",
  "SubmitBlock serialization error",
  "Invalid authorization header",
  "Encountered gRPC error",
  "Error parsing URL",
];

// The relay's own rejection/demotion lines (verified against a local checkout
// of flashbots/mev-boost-relay's services/api/service.go).
const RELAY_REJECT_MARKERS = [
  "block validation failed",
  "demoting builder",
  "payload attributes not (yet) known",
  "invalid builder signature",
  "not the expected proposer index",
];

type ProcessState = { is_running: boolean; exit_code: number; restarts: number; status: string };

async function elProcessState(): Promise<ProcessState | null> {
  const { stdout, code } = await new Deno.Command("process-compose", {
    args: ["process", "get", EL_PROCESS_NAME, "-o", "json"],
  }).output();
  if (code !== 0) return null;
  const parsed = JSON.parse(new TextDecoder().decode(stdout));
  return parsed[0] ?? null;
}

async function elProcessLogTail(): Promise<string> {
  const { stdout } = await new Deno.Command("process-compose", {
    args: ["process", "logs", EL_PROCESS_NAME, "--tail", String(LOG_TAIL_LINES)],
  }).output();
  return new TextDecoder().decode(stdout);
}

// Podman propagates a pod's `app` label onto its containers (see
// renderers/podman.ts), so this finds a container regardless of whatever
// internal name `podman kube play` assigned it.
async function podmanContainerName(podLabel: string): Promise<string> {
  const { stdout } = await new Deno.Command("podman", {
    args: ["ps", "-a", "--filter", `label=app=${podLabel}`, "--format", "{{.Names}}"],
  }).output();
  const name = new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`pipeline-check: no container found for pod '${podLabel}' (is the recipe up?)`);
  return name;
}

async function podmanLogsSince(containerName: string, sinceIso: string): Promise<string> {
  const { stdout, stderr } = await new Deno.Command("podman", {
    args: ["logs", "--since", sinceIso, containerName],
  }).output();
  return new TextDecoder().decode(stdout) + "\n" + new TextDecoder().decode(stderr);
}

function firstMatch(log: string, markers: string[]): string | null {
  for (const line of log.split("\n")) {
    if (markers.some((m) => line.includes(m))) return line.trim();
  }
  return null;
}

async function waitForRpc(client: ReturnType<typeof makeClient>, deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    try {
      await chainId(client);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`pipeline-check: RPC at ${RPC} not reachable before deadline`);
}

async function bidtrace(path: string, blockNumber: number): Promise<unknown[]> {
  const url = `${RELAY}${path}?block_number=${blockNumber}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return await r.json();
}

// Cheapest, most direct check first: is el-1 even alive? If not, that's the
// answer, full stop — no need to look anywhere downstream.
async function diagnoseEl1Crashed(): Promise<boolean> {
  const state = await elProcessState();
  if (!state) {
    console.error(err(`✗ SUSPECT: el-1 — process-compose unreachable; is the recipe up?`));
    return true;
  }
  if (!state.is_running) {
    console.error(
      err(`✗ SUSPECT: el-1 — process is not running (status=${state.status}, exit_code=${state.exit_code}, restarts=${state.restarts}).`),
    );
    return true;
  }
  return false;
}

// Did rbuilder even have the tx in its mempool view when it built this block?
// ("Stopping simulation job ... orders_received=OrderCounter { ..., mempool_txs: N }"
// per block, verified against relay_submit.rs/simulation_job.rs.) If it never
// saw it, a missing bid is a timing race, not a real fault — the tx simply
// arrived after rbuilder's build window for that slot had already closed.
async function el1SawMempoolTxForBlock(blockNumber: number): Promise<boolean> {
  const log = await elProcessLogTail();
  const blockMarker = `sim_ctx{block=${blockNumber}`;
  for (const line of log.split("\n")) {
    if (!line.includes(blockMarker)) continue;
    const m = line.match(/orders_received=OrderCounter \{ total: \d+, mempool_txs: (\d+)/);
    if (m && parseInt(m[1], 10) > 0) return true;
  }
  return false;
}

// el-1 is alive but never got a bid to the relay for this block. Returns
// whether this is worth retrying (a timing miss) vs. a real, reportable fault.
async function diagnoseEl1NotSubmitted(blockNumber: number): Promise<{ retry: boolean }> {
  if (!(await el1SawMempoolTxForBlock(blockNumber))) {
    return { retry: true };
  }
  const log = await elProcessLogTail();
  const reason = firstMatch(log, RBUILDER_ERROR_MARKERS);
  if (reason) {
    console.error(err(`✗ SUSPECT: el-1 — saw the tx, but its own log shows: "${reason}"`));
  } else {
    console.error(err(`✗ SUSPECT: el-1 — saw the tx, tried to build, but no bid ever reached the relay, and no error in its log. Check \`decker attach\`.`));
  }
  return { retry: false };
}

// el-1 submitted fine and the relay is the one that rejected it — the reason
// lives in the relay's own log, not el-1's.
async function diagnoseRelay(sinceIso: string, blockNumber: number): Promise<void> {
  const name = await podmanContainerName(RELAY_POD_LABEL);
  const log = await podmanLogsSince(name, sinceIso);
  const reason = firstMatch(log, RELAY_REJECT_MARKERS);
  if (reason) {
    console.error(err(`✗ SUSPECT: mev-boost-relay-1 — its log shows: "${reason}"`));
  } else {
    console.error(
      err(`✗ SUSPECT: mev-boost-relay-1 — bid received for block ${blockNumber} but never delivered; no known rejection line found. Check \`podman logs ${name}\`.`),
    );
  }
}

async function diagnoseValidator(sinceIso: string): Promise<void> {
  const name = await podmanContainerName(VALIDATOR_POD_LABEL);
  const log = await podmanLogsSince(name, sinceIso);
  if (log.includes("Error whilst producing block")) {
    console.error(err(`✗ SUSPECT: validator-1 — its log shows "Error whilst producing block". Check \`podman logs ${name}\`.`));
  } else if (log.includes("Successfully published block")) {
    console.error(err(`✗ SUSPECT: beacon-1 — validator-1 published a block fine, but it wasn't the builder's. Check beacon-1's relay connection.`));
  } else {
    console.error(err(`✗ SUSPECT: validator-1 — no proposal activity logged since ${sinceIso}; it may not be running or never got a duty.`));
  }
}

const MAX_ATTEMPTS = 3;

// One attempt: send a tx, wait for its receipt, check who built the winning
// block. Returns "ok" (pipeline worked), "retry" (inconclusive — a timing
// miss, not a fault, try again), or "fail" (a real, already-reported fault).
async function attempt(client: ReturnType<typeof makeClient>, wallet: Wallet, toAddress: string, type: TxType): Promise<"ok" | "retry" | "fail"> {
  const cid = await chainId(client);
  const nonce = await pendingNonce(client, wallet.address);
  const signed = await signTx(type, wallet, toAddress, nonce, cid);
  const sentAt = new Date().toISOString();
  const txHash = await sendRawTx(client, signed);
  console.log(`${dim(`TX Hash (${type}):`)} ${accent(txHash)}`);

  console.log(dim("Waiting for receipt…"));
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt: Awaited<ReturnType<typeof getReceipt>> = null;
  while (Date.now() < deadline && !receipt) {
    await new Promise((r) => setTimeout(r, 1000));
    receipt = await getReceipt(client, txHash).catch(() => null);
  }
  if (!receipt) {
    if (!(await diagnoseEl1Crashed())) {
      console.error(err(`✗ SUSPECT: el-1 — alive, but no receipt within ${RECEIPT_TIMEOUT_MS}ms. Check \`decker attach\`.`));
    }
    return "fail";
  }

  const blockNumber = parseInt(receipt.blockNumber, 16);
  const extraData = tryUtf8(await getBlockExtraData(client, receipt.blockNumber));
  console.log(`${dim("Block:")} ${accent(String(blockNumber))}  ${dim("Extra Data:")} ${accent(extraData)}`);

  if (extraData === EXPECTED_EXTRA_DATA) {
    console.log(success(`✓ pipeline OK — ${type} tx included in a builder-won block (${blockNumber})`));
    return "ok";
  }

  if (await diagnoseEl1Crashed()) return "fail";

  const received = await bidtrace("/relay/v1/data/bidtraces/builder_blocks_received", blockNumber);
  if (received.length === 0) {
    const { retry } = await diagnoseEl1NotSubmitted(blockNumber);
    return retry ? "retry" : "fail";
  }

  const delivered = await bidtrace("/relay/v1/data/bidtraces/proposer_payload_delivered", blockNumber);
  if (delivered.length === 0) {
    await diagnoseRelay(sentAt, blockNumber);
    return "fail";
  }

  await diagnoseValidator(sentAt);
  return "fail";
}

async function verify(client: ReturnType<typeof makeClient>, wallet: Wallet, toAddress: string, type: TxType): Promise<void> {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const result = await attempt(client, wallet, toAddress, type);
    if (result === "ok") return;
    if (result === "fail") throw new Error(`pipeline check failed on a ${type} tx (suspect reported above)`);
    console.log(dim(`Attempt ${i}/${MAX_ATTEMPTS} (${type}): rbuilder never saw the tx in time (timing miss, not a fault) — retrying…`));
  }
  console.error(err(`✗ SUSPECT: el-1 — never saw the ${type} tx in time across ${MAX_ATTEMPTS} attempts. Check its bidding window / mempool propagation.`));
  throw new Error(`no builder-won block with a ${type} tx in ${MAX_ATTEMPTS} attempts`);
}

async function run(): Promise<void> {
  const wallet = new Wallet(STATIC_PREFUNDED[1]);
  const toAddress = new Wallet(STATIC_PREFUNDED[0]).address;
  const client = makeClient(RPC, wallet);

  console.log(dim(`Waiting for RPC at ${RPC}…`));
  try {
    await waitForRpc(client, Date.now() + READY_TIMEOUT_MS);
  } catch {
    await diagnoseEl1Crashed();
    throw new Error("el-1 RPC never became reachable");
  }

  // Legacy first: proves the plain pipeline. Then a blob tx through the same
  // gauntlet — sidecar handling (builder -> relay -> beacon) is its own path.
  await verify(client, wallet, toAddress, "legacy");
  await verify(client, wallet, toAddress, "blob");
}

// The recipe-script form: `decker up` runs this after everything has started.
export function pipelineCheck(): Script {
  const script: Script = async () => {
    await run();
  };
  Object.defineProperty(script, "name", { value: "pipeline-check" });
  return script;
}

if (import.meta.main) {
  try {
    await run();
  } catch (e) {
    console.error(err(`✗ ${(e as Error).message}`));
    Deno.exit(1);
  }
}
