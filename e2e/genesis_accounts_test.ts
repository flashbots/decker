import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { withTmp } from "./helpers.ts";
import { generate } from "../generators/l1/index.ts";
import { renderElGenesis } from "../generators/l1/el-genesis.ts";
import { allocStateRoot, type GenesisAlloc } from "../generators/l1/state-root.ts";
import { L1_STATE_ROOT } from "../generators/l1/el-block-hash.ts";

const TEMPLATE_URL = new URL("../generators/l1/el-genesis-template.json", import.meta.url);

// A predeploy: helix's PaymentForwarder runtime at its canonical address.
const FORWARDER = "0xFEEEEEE44046c3f61a8CC081E0918eF0de0a7ffC";
const FORWARDER_CODE = "0x5f358060e01c4218600f5760401cff5b5f5ffd00";

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

async function templateAlloc(): Promise<GenesisAlloc> {
  return JSON.parse(await Deno.readTextFile(TEMPLATE_URL)).alloc;
}

// The one root we know independently: the vendored alloc's, baked into
// el-block-hash.ts and matched against geth/reth long before this trie existed.
// If this fails, the trie is wrong and every computed root is suspect.
Deno.test("state root: vendored alloc reproduces L1_STATE_ROOT", async () => {
  assertEquals(hex(allocStateRoot(await templateAlloc())), hex(L1_STATE_ROOT));
});

Deno.test("state root: an added account changes the root", async () => {
  const alloc = { ...await templateAlloc(), [FORWARDER]: { code: FORWARDER_CODE, balance: "0x0" } };
  assert(hex(allocStateRoot(alloc)) !== hex(L1_STATE_ROOT));
});

Deno.test("genesisAccounts: predeploy lands in genesis.json and in the CL's state root", async () => {
  await withTmp(async (dir) => {
    const outDir = join(dir, "artifacts");
    await Deno.mkdir(outDir, { recursive: true });
    await generate({
      outDir,
      fork: "fulu",
      genesisAccounts: { [FORWARDER]: { code: FORWARDER_CODE, balance: "0x0" } },
    });

    const g = JSON.parse(await Deno.readTextFile(join(outDir, "genesis.json")));
    const account = g.alloc[FORWARDER.slice(2).toLowerCase()];
    assertEquals(account?.code, FORWARDER_CODE);

    // The CL genesis state must carry the same root the EL will compute from
    // that alloc — it is embedded verbatim in latestExecutionPayloadHeader.
    const root = allocStateRoot(g.alloc);
    const ssz = await Deno.readFile(join(outDir, "testnet", "genesis.ssz"));
    assert(
      hex(ssz).includes(hex(root)),
      "genesis.ssz does not embed the computed genesis state root",
    );
  });
});

Deno.test("genesisAccounts: an address already in the template is rejected", async () => {
  await assertRejects(
    () =>
      renderElGenesis({
        genesisTimeSeconds: 1,
        fork: "fulu",
        // The deposit contract, which the template already allocates.
        genesisAccounts: { "0x4242424242424242424242424242424242424242": { balance: "0x1" } },
      }),
    Error,
    "already in the genesis template",
  );
});
