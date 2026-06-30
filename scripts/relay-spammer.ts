// Synthetic builder-block spammer. Replaces the rbuilder+contender load pods for the
// relay bench: instead of building real blocks, it forges minimal submitBlock requests
// and POSTs them directly to the relay. This is only valid because the bench runs the
// mock simulator (always answers "valid"), so the relay accepts the forged blocks either
// way — in synchronous mode it waits on the instant mock reply, in optimistic mode sim is
// off the bid path entirely.
//
// Pacing is EVENT-DRIVEN: the beacon's payload_attributes SSE is the clock. Each new
// slot's event wakes us to fire that slot's package of N submissions; between events we
// idle on reader.read(). No timers or sleeps drive the load (only a run deadline).
//
// What must be REAL (mirrored from the payload_attributes event, the same source the
// relay uses): parent_hash, slot, timestamp, prev_randao, withdrawals. What can be fake
// (never validated pre-sim): block_hash, state/receipts roots, transactions. The proposer
// fee_recipient + pubkey come from the relay's own duties so they match exactly.

import { ssz } from "npm:@lodestar/types@^1.30.0";
import { ByteVectorType, ContainerType, UintBigintType } from "npm:@chainsafe/ssz@^1.2.0";
import { bls12_381 } from "npm:@noble/curves@^1.4.0/bls12-381";

const BLS_DST = new TextEncoder().encode("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_");
const DOMAIN_APPLICATION_BUILDER = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
const ZERO_BLOOM = "0x" + "00".repeat(256);
// A realistic-sized opaque transaction blob (~300 bytes, like a typical EIP-1559 tx).
// Never decoded or executed pre-sim — it only exists to make the block's read/decode
// cost representative. txsPerBlock copies fill each block's transactions list.
const DUMMY_TX = "0x" + "ab".repeat(300);

const fromHex = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const toHex = (b: Uint8Array): string => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

// DOMAIN_APPLICATION_BUILDER with a zero genesis_validators_root (builder domain is
// network-independent except for the fork version) — identical to relay-warmup.ts.
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

// The relay's BidTrace SSZ container (builder-specs order). lodestar doesn't export it,
// so define it; jsonCase "eth2" makes toJson emit the snake_case fields the relay wants.
const BidTrace = new ContainerType({
  slot: new UintBigintType(8),
  parentHash: new ByteVectorType(32),
  blockHash: new ByteVectorType(32),
  builderPubkey: new ByteVectorType(48),
  proposerPubkey: new ByteVectorType(48),
  proposerFeeRecipient: new ByteVectorType(20),
  gasLimit: new UintBigintType(8),
  gasUsed: new UintBigintType(8),
  value: new UintBigintType(32),
}, { typeName: "BidTrace", jsonCase: "eth2" });

type Withdrawal = { index: string; validator_index: string; address: string; amount: string };
// Everything we must mirror, carried in one payload_attributes event.
type Attrs = {
  slot: bigint;
  parentHash: string;
  parentNumber: bigint;
  timestamp: bigint;
  prevRandao: string;
  withdrawals: Withdrawal[];
};
// Per-slot proposer duty (from the relay) — fee_recipient must match, pubkey lets
// getHeader find the bid.
type Duty = { feeRecipient: string; gasLimit: number; pubkey: string };

export type SpamOpts = {
  relayUrl: string; // e.g. http://localhost:9062
  beaconUrl: string; // e.g. http://localhost:3500
  genesisForkVersion: Uint8Array;
  builderKeys: { priv: string; pub: string }[];
  perSlot: number; // how many submissions to fire per slot
  txsPerBlock?: number; // transactions per submitted block (default 1) — controls block size
  deadlineMs: number;
};

export type SpamResult = {
  sent: number;
  accepted: number;
  rejected: number;
  slots: number;
  lastError?: string;
  // client-observed round-trip per submission (send → HTTP response), in ms
  rttAvgMs?: number;
  rttP50Ms?: number;
  rttP99Ms?: number;
  rttMaxMs?: number;
};

// Parse one SSE frame into Attrs (or null if it isn't a usable payload_attributes event).
function parseAttrs(frame: string): Attrs | null {
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return null;
  let d: Record<string, unknown> | undefined;
  try {
    d = (JSON.parse(dataLine.slice(5).trim()) as { data?: Record<string, unknown> })?.data;
  } catch {
    return null;
  }
  if (!d) return null;
  const pa = d.payload_attributes as Record<string, unknown>;
  return {
    slot: BigInt(d.proposal_slot as string),
    parentHash: d.parent_block_hash as string,
    parentNumber: BigInt(d.parent_block_number as string),
    timestamp: BigInt(pa.timestamp as string),
    prevRandao: pa.prev_randao as string,
    withdrawals: (pa.withdrawals as Withdrawal[]) ?? [],
  };
}

// Forge one submitBlock JSON for the given attrs, signed by `key`. `blockHash` must be
// distinct per call (dedup) and is echoed into both the bid trace and the payload.
function buildSubmission(o: {
  attrs: Attrs;
  key: { priv: string; pub: string };
  domain: Uint8Array;
  proposerFeeRecipient: string;
  proposerPubkey: string;
  gasLimit: number;
  value: bigint;
  blockHash: Uint8Array;
  txs: string[];
}): Record<string, unknown> {
  const bt = {
    slot: o.attrs.slot,
    parentHash: fromHex(o.attrs.parentHash),
    blockHash: o.blockHash,
    builderPubkey: fromHex(o.key.pub),
    proposerPubkey: fromHex(o.proposerPubkey),
    proposerFeeRecipient: fromHex(o.proposerFeeRecipient),
    gasLimit: BigInt(o.gasLimit),
    gasUsed: 21000n,
    value: o.value,
  };
  const root = BidTrace.hashTreeRoot(bt);
  const signingRoot = ssz.phase0.SigningData.hashTreeRoot({ objectRoot: root, domain: o.domain });
  const sig = bls12_381.sign(signingRoot, fromHex(o.key.priv), { DST: BLS_DST });
  const bh = toHex(o.blockHash);

  return {
    message: BidTrace.toJson(bt),
    execution_payload: {
      parent_hash: o.attrs.parentHash,
      fee_recipient: o.proposerFeeRecipient,
      state_root: toHex(new Uint8Array(32)),
      receipts_root: toHex(new Uint8Array(32)),
      logs_bloom: ZERO_BLOOM,
      prev_randao: o.attrs.prevRandao,
      block_number: String(o.attrs.parentNumber + 1n),
      gas_limit: String(o.gasLimit),
      gas_used: "21000",
      timestamp: String(o.attrs.timestamp),
      extra_data: "0x",
      base_fee_per_gas: "7",
      block_hash: bh,
      transactions: o.txs,
      withdrawals: o.attrs.withdrawals,
      blob_gas_used: "0",
      excess_blob_gas: "0",
    },
    blobs_bundle: { commitments: [], proofs: [], blobs: [] },
    execution_requests: { deposits: [], withdrawals: [], consolidations: [] },
    signature: toHex(sig),
  };
}

async function postSubmission(relayUrl: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await fetch(`${relayUrl}/relay/v1/builder/blocks`, {
    method: "POST",
    headers: { "content-type": "application/json", "eth-consensus-version": "fulu" },
    body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: 0, text: () => String(e) } as unknown as Response));
  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text };
}

// Event-driven spammer: the beacon's payload_attributes stream is the clock. On each new
// slot we fire that slot's `perSlot` submissions ONE AFTER ANOTHER (await each), then idle
// on the next read(). Sequential-by-design: see fireSlotPackage for why.
export async function spamRelay(opts: SpamOpts): Promise<SpamResult> {
  const ac = new AbortController();
  // Single timer: the run deadline (not load pacing). Aborts the SSE read so we stop.
  const deadlineTimer = setTimeout(() => ac.abort(), Math.max(0, opts.deadlineMs - Date.now()));
  const domain = builderDomain(opts.genesisForkVersion);
  const res: SpamResult = { sent: 0, accepted: 0, rejected: 0, slots: 0 };
  const rtts: number[] = [];
  const dutyCache = new Map<string, Duty>();
  let counter = 0;
  const baseValue = 1_000_000_000_000_000_000n; // 1 ETH floor base
  const txs = Array(opts.txsPerBlock ?? 1).fill(DUMMY_TX); // same blob in every block — never parsed

  const refreshDuties = async () => {
    try {
      const r = await fetch(`${opts.relayUrl}/relay/v1/builder/validators`, { signal: ac.signal });
      const arr = await r.json() as Array<{ slot: string; entry: { message: { fee_recipient: string; gas_limit: string; pubkey: string } } }>;
      for (const d of arr) {
        dutyCache.set(String(d.slot), {
          feeRecipient: d.entry.message.fee_recipient,
          gasLimit: Number(d.entry.message.gas_limit),
          pubkey: d.entry.message.pubkey,
        });
      }
    } catch (_e) { /* keep whatever we have */ }
  };

  // Fire this slot's submissions ONE AFTER ANOTHER (await each). Because each send waits for
  // the previous to land, values arrive in strictly increasing order, so every submission
  // beats the current floor and the relay MUST fully process it — no early skip. That forces
  // equal work on both relays (helix processes all anyway), so the latency is a real
  // per-submission speed comparison instead of one inflated by skipped work. Sequential is
  // closed-loop on purpose here: we're measuring worst-case per-submission latency, not a
  // sustained offered rate.
  const fireSlotPackage = async (attrs: Attrs, duty: Duty) => {
    for (let i = 0; i < opts.perSlot && !ac.signal.aborted; i++) {
      counter++;
      const blockHash = new Uint8Array(32);
      new DataView(blockHash.buffer).setUint32(28, counter);
      const key = opts.builderKeys[counter % opts.builderKeys.length];
      const body = buildSubmission({
        attrs, key, domain, txs,
        proposerFeeRecipient: duty.feeRecipient,
        proposerPubkey: duty.pubkey,
        gasLimit: duty.gasLimit,
        value: baseValue + BigInt(counter),
        blockHash,
      });
      res.sent++;
      const t0 = performance.now();
      const out = await postSubmission(opts.relayUrl, body);
      rtts.push(performance.now() - t0);
      if (out.ok) res.accepted++;
      else {
        res.rejected++;
        res.lastError = `${out.status} ${out.text.slice(0, 160)}`;
      }
    }
  };

  let lastSlot = -1n;
  while (!ac.signal.aborted) {
    try {
      const r = await fetch(`${opts.beaconUrl}/eth/v1/events?topics=payload_attributes`, {
        headers: { accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!r.body) throw new Error("no SSE body");
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      while (!ac.signal.aborted) {
        const { value, done } = await reader.read(); // idle here until the next slot event
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const attrs = parseAttrs(frame);
          if (!attrs || attrs.slot === lastSlot) continue;
          lastSlot = attrs.slot;
          if (!dutyCache.has(String(attrs.slot))) await refreshDuties();
          const duty = dutyCache.get(String(attrs.slot));
          if (duty) {
            res.slots++;
            await fireSlotPackage(attrs, duty);
          }
        }
      }
    } catch (_e) {
      if (ac.signal.aborted) break;
      // transient SSE disconnect — loop reconnects (connection recovery, not load pacing)
    }
  }

  clearTimeout(deadlineTimer);
  if (rtts.length) {
    const s = [...rtts].sort((a, b) => a - b);
    const r3 = (x: number) => Math.round(x * 100) / 100;
    res.rttAvgMs = r3(rtts.reduce((a, x) => a + x, 0) / rtts.length);
    res.rttP50Ms = r3(s[Math.floor(s.length * 0.5)]);
    res.rttP99Ms = r3(s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]);
    res.rttMaxMs = r3(s[s.length - 1]);
  }
  return res;
}
