// Pre-registers validators with relays before genesis so rbuilders can bid
// from slot 0 instead of waiting for the lighthouse-validator's epoch-tick
// registration + housekeeper duty fetch (~6 min cold start).

import { ssz } from "npm:@lodestar/types@^1.30.0";
import { bls12_381 } from "npm:@noble/curves@^1.4.0/bls12-381";
import { loadBlsKeys } from "../generators/l1/bls-keys.ts";
import { artifactsHostPath } from "../utils/build.ts";
import { findComponent, lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import type { Recipe, Script } from "../utils/types.ts";

const BLS_DST = new TextEncoder().encode("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_");
const DOMAIN_APPLICATION_BUILDER = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
const DEFAULT_FEE_RECIPIENT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEFAULT_GAS_LIMIT = 60_000_000;
const DEFAULT_REGISTER_PATH = "/eth/v1/builder/validators";
const DEFAULT_PORT_NAME = "http";

export type WarmupRelay = {
  container: string;
};

export type WarmupSpec = {
  relays: WarmupRelay[];
  feeRecipient?: string;
  gasLimit?: number;
};

const fromHex = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const toHex = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

function readGenesisForkVersion(recipe: Recipe): Uint8Array {
  const path = `${artifactsHostPath(recipe)}/testnet/config.yaml`;
  const text = Deno.readTextFileSync(path);
  const m = text.match(/^GENESIS_FORK_VERSION:\s*(0x[0-9a-fA-F]+)/m);
  if (!m) throw new Error(`relay-warmup: GENESIS_FORK_VERSION missing from ${path}`);
  return fromHex(m[1]);
}

// genesis.ssz first 8 bytes = BeaconState.genesis_time (uint64 LE).
function readGenesisTime(recipe: Recipe): number {
  const path = `${artifactsHostPath(recipe)}/testnet/genesis.ssz`;
  const buf = Deno.readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, 8);
  return Number(view.getBigUint64(0, true));
}

function builderDomain(genesisForkVersion: Uint8Array): Uint8Array {
  const forkDataRoot = ssz.phase0.ForkData.hashTreeRoot({
    currentVersion: genesisForkVersion,
    genesisValidatorsRoot: new Uint8Array(32),
  });
  const domain = new Uint8Array(32);
  domain.set(DOMAIN_APPLICATION_BUILDER, 0);
  domain.set(forkDataRoot.slice(0, 28), 4);
  return domain;
}

function buildSignedRegistrations(opts: {
  domain: Uint8Array;
  feeRecipient: Uint8Array;
  gasLimit: number;
  timestamp: number;
  keys: { priv: string; pub: string }[];
}) {
  const out: Array<{
    message: { fee_recipient: string; gas_limit: string; timestamp: string; pubkey: string };
    signature: string;
  }> = [];
  for (const k of opts.keys) {
    const pubkey = fromHex(k.pub);
    const objectRoot = ssz.bellatrix.ValidatorRegistrationV1.hashTreeRoot({
      feeRecipient: opts.feeRecipient,
      gasLimit: opts.gasLimit,
      timestamp: opts.timestamp,
      pubkey,
    });
    const signingRoot = ssz.phase0.SigningData.hashTreeRoot({ objectRoot, domain: opts.domain });
    const sig = bls12_381.sign(signingRoot, fromHex(k.priv), { DST: BLS_DST });
    out.push({
      message: {
        fee_recipient: "0x" + toHex(opts.feeRecipient),
        gas_limit: String(opts.gasLimit),
        timestamp: String(opts.timestamp),
        pubkey: "0x" + k.pub,
      },
      signature: "0x" + toHex(sig),
    });
  }
  return out;
}

function resolveRelayUrl(recipe: Recipe, relay: WarmupRelay): string {
  const loc = findComponent(recipe, relay.container);
  if (loc.kind !== "container") {
    throw new Error(`relay-warmup: ${relay.container} is not a container`);
  }
  const proto = lookup(loc.def.prototype);
  const portSpec = (loc.def.config?.ports as Record<string, unknown> | undefined)?.[DEFAULT_PORT_NAME]
    ?? proto.ports[DEFAULT_PORT_NAME];
  if (portSpec === undefined) {
    throw new Error(`relay-warmup: relay ${relay.container} has no port ${DEFAULT_PORT_NAME}`);
  }
  const port = portNum(portSpec as Parameters<typeof portNum>[0]);
  return `http://localhost:${port}`;
}

async function waitForRelay(url: string, deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    try {
      const r = await fetch(`${url}/eth/v1/builder/status`);
      if (r.ok) return;
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`relay-warmup: relay at ${url} not reachable before deadline`);
}

async function postRegistrations(
  url: string,
  path: string,
  registrations: ReturnType<typeof buildSignedRegistrations>,
): Promise<void> {
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registrations),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`relay-warmup: POST ${url}${path} → ${r.status} ${body.slice(0, 200)}`);
  }
}

// mev-boost-relay enforces timestamp ∈ [genesis_time, now+10s]. Pre-genesis we
// can't satisfy both bounds, so wait until just before genesis and use
// timestamp = genesis_time.
const PRE_GENESIS_LEAD_SEC = 5;

export function relayWarmup(spec: WarmupSpec): Script {
  const run: Script = async (recipe: Recipe) => {
    if (spec.relays.length === 0) return;

    const feeRecipient = fromHex(spec.feeRecipient ?? DEFAULT_FEE_RECIPIENT);
    if (feeRecipient.length !== 20) throw new Error(`relay-warmup: feeRecipient must be 20 bytes`);
    const gasLimit = spec.gasLimit ?? DEFAULT_GAS_LIMIT;
    const genesisTime = readGenesisTime(recipe);
    const targetWakeMs = (genesisTime - PRE_GENESIS_LEAD_SEC) * 1000;
    const waitMs = targetWakeMs - Date.now();
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

    const timestamp = genesisTime;
    const domain = builderDomain(readGenesisForkVersion(recipe));
    const keys = await loadBlsKeys();
    const registrations = buildSignedRegistrations({
      domain,
      feeRecipient,
      gasLimit,
      timestamp,
      keys,
    });

    const reachDeadline = Date.now() + 30_000;
    for (const relay of spec.relays) {
      const url = resolveRelayUrl(recipe, relay);
      await waitForRelay(url, reachDeadline);
      await postRegistrations(url, DEFAULT_REGISTER_PATH, registrations);
    }
  };
  Object.defineProperty(run, "name", { value: "relay-warmup" });
  return run;
}
