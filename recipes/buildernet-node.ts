import type { Recipe } from "../utils/types.ts";
import type { RecipeOptions } from "../utils/build.ts";
import { relayWarmup } from "../scripts/relay-warmup.ts";
import { triePadding } from "../scripts/trie-padding.ts";

// buildernet-node: the `rbuilder` L1 PBS devnet with the builder shaped like a
// PRODUCTION BuilderNet node (flashbots-images origin/trunk/buildernet +
// buildernet-configs production, pins as of 2026-09-16):
//
//   users -> haproxy-1 :80 -> flowproxy-1 :5543 -> el-1 (rbuilder-operator-reth) :8645
//   other nodes ------------> haproxy-1 :5544 -> flowproxy-1 :5542
//   el-1 built blocks -> bidding-gateway-1 :6072 -> mev-boost-relay-1 -> beacon/validator
//
// Not reproduced (a dev env is not a TEE image): TDX/attested-TLS, Builder
// Hub-rendered config (values are decker fixtures, templates are mirrored),
// ClickHouse sinks, nftables, rebalancer, pamm-stream, vector, ACME/TLS at the
// edge. See ALP's DESIGN-bn-node-arena.md for the full table.
// anvil dev account #9: prefunded in generators/l1/el-genesis-template.json
const DEVNET_FEE_RECIPIENT = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";

// Options (`--opt key=value`, or ALP spec.stackOptions):
//   rbuilder.<key>=<raw toml value>  override one top-level key of the builder's
//                                    rbuilder.toml (containers/rbuilder-operator-reth.ts
//                                    applyTomlOverrides). Production shape is the
//                                    default; every override is a visible deviation.
//                                    e.g. rbuilder.evm_caching_enable=false
//                                         rbuilder.live_builders=["mp-ordering-200ms"]
//   withdrawals=none                 validators get BLS (0x00) creds: no per-block
//                                    withdrawal sweeps (bisection lever; default eth1)
//   triePadding=<n>                  warmup creates n fresh accounts via el-1's RPC
//                                    before load, so the state trie has mainnet-like
//                                    depth instead of 12 leaves off the root (default 0)
export function recipe(raw: RecipeOptions = {}): Recipe {
  const rbuilderToml: Record<string, string> = {};
  let withdrawals: "eth1" | "none" = "eth1";
  let triePad = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("rbuilder.")) {
      rbuilderToml[k.slice("rbuilder.".length)] = String(v);
    } else if (k === "withdrawals" && (v === "eth1" || v === "none")) {
      withdrawals = v;
    } else if (k === "triePadding" && /^\d+$/.test(String(v))) {
      triePad = Number(v);
    } else {
      throw new Error(
        `buildernet-node: unknown option ${k}=${v} (known: rbuilder.<toml key>, withdrawals=eth1|none, triePadding=<n>)`,
      );
    }
  }
  return {
    artifacts: { generator: "l1", fork: "electra", withdrawals },
    scripts: [
      // feeRecipient: the relay's validator registrations decide the proposer
      // the builder pays. decker's default is anvil #0 - the builder's own
      // coinbase - and the gateway refuses a payout to the builder itself
      // ("placeholder pays the builder itself"). anvil #9 exists in genesis and
      // is nobody's coinbase.
      relayWarmup({
        relays: [{ container: "mev-boost-relay-1" }],
        feeRecipient: DEVNET_FEE_RECIPIENT,
      }),
      triePadding({ el: "el-1", accounts: triePad }),
    ],
    pods: [
      {
        // reth + rbuilder + operator in ONE process - the production binary.
        name: "el-1",
        containers: [
          {
            name: "el-1",
            prototype: "rbuilder-operator-reth",
            refs: { beacon: "beacon-1", gateway: "bidding-gateway-1" },
            config: { rbuilderToml },
          },
        ],
      },
      {
        name: "bidding-gateway-1",
        containers: [
          {
            name: "bidding-gateway-1",
            prototype: "bidding-gateway",
            refs: { relay: "mev-boost-relay-1" },
          },
        ],
      },
      {
        name: "flowproxy-1",
        containers: [
          {
            name: "flowproxy-1",
            prototype: "flowproxy",
            refs: { builder: "el-1" },
          },
        ],
      },
      {
        name: "haproxy-1",
        containers: [
          {
            name: "haproxy-1",
            prototype: "haproxy",
            refs: { flowproxy: "flowproxy-1" },
          },
        ],
      },
      {
        name: "beacon-1",
        containers: [
          {
            name: "beacon-1",
            prototype: "lighthouse-beacon",
            // production CL: lighthouse v8.2.0 (18-lighthouse.sh.chroot, 120c3c6d).
            // feeRecipient: the bidding gateway proves the proposer payment against
            // the shipped state, so the proposer must exist in genesis - decker's
            // default 0x690B.. does not (gateway: "proposer absent from the shipped
            // state"); anvil dev account #9 is prefunded in the L1 alloc.
            config: {
              image: "docker.io/sigp/lighthouse:v8.2.0",
              feeRecipient: DEVNET_FEE_RECIPIENT,
            },
            refs: { el: "el-1", builder: "mev-boost-relay-1" },
          },
        ],
      },
      {
        name: "validator-1",
        containers: [
          {
            name: "validator-1",
            prototype: "lighthouse-validator",
            config: {
              image: "docker.io/sigp/lighthouse:v8.2.0",
              feeRecipient: DEVNET_FEE_RECIPIENT,
            },
            refs: { beacon: "beacon-1" },
          },
        ],
      },
      {
        name: "mev-boost-relay-1",
        containers: [
          { name: "pg-mb-1", prototype: "mev-boost-relay-postgres" },
          { name: "redis-mb-1", prototype: "redis" },
          {
            name: "housekeeper-mb-1",
            prototype: "mev-boost-housekeeper",
            refs: {
              beacon: "beacon-1",
              postgres: "pg-mb-1",
              redis: "redis-mb-1",
            },
          },
          {
            name: "mev-boost-relay-1",
            prototype: "mev-boost-relay",
            refs: {
              beacon: "beacon-1",
              postgres: "pg-mb-1",
              redis: "redis-mb-1",
              el: "el-1",
            },
          },
        ],
      },
    ],
  };
}
