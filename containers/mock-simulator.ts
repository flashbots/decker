import type { ContainerDef, ContainerResult } from "../utils/types.ts";

// A stub block-validation "simulator". Both mev-boost-relay (--blocksim) and helix
// (simulators.url) call their simulator over JSON-RPC with
// flashbots_validateBuilderSubmissionV{2..5}; a response with NO `error` field means
// "valid". This always answers valid, so the relays never see a sim failure and never
// demote a builder — which lets the bench's synthetic block-spammer submit blocks a real
// EL would reject. In synchronous mode the relay just waits on this instant "valid" reply;
// in optimistic mode sim is off the bid path anyway. It also keeps the box light: no real
// reth re-executing blocks.
//
// It also answers eth_getBalance (helix reads it for builder collateral) with a huge
// value, and falls back to HTTP 200 for the SSZ /validate path, so either relay's
// simulator transport is satisfied.

// Off the standard 8545 so the host-exposed port can't collide with el-1's reth.
const RPC_PORT = 28545;

export const ports = {
  rpc: RPC_PORT,
};

const SERVER = `
const reply = (r) => {
  const m = r?.method ?? "";
  let result = null;
  if (m === "eth_getBalance") result = "0xffffffffffffffffffffffffffffffff";
  else if (m === "eth_chainId") result = "0x539";
  else if (m === "eth_blockNumber") result = "0x1";
  // helix polls eth_syncing to decide if the simulator is "synced"; only result===false
  // counts as synced, which flips its accept_optimistic flag on. null reads as "syncing".
  else if (m === "eth_syncing") result = false;
  // validateBuilderSubmission* (and anything else): result null, NO error => valid
  return { jsonrpc: "2.0", id: r?.id ?? 1, result };
};

Deno.serve({ port: ${RPC_PORT}, hostname: "0.0.0.0" }, async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    // not JSON (e.g. SSZ submission to /validate) -> treat as valid
    return new Response("", { status: 200 });
  }
  const out = Array.isArray(body) ? body.map(reply) : reply(body);
  return Response.json(out);
});
`;

export function buildContainer(_def: ContainerDef): ContainerResult {
  return {
    container: {
      image: "docker.io/denoland/deno:alpine",
      command: ["deno", "run", "--allow-net", "/mock-sim.ts"],
      ports,
    },
    configs: [
      { filename: "mock-sim.ts", content: SERVER, mountPath: "/mock-sim.ts" },
    ],
  };
}
