// The devnet's genesis predeploys are what keeps builder-sealed blocks valid:
// a missing PaymentForwarder makes every sealed block fail with "mismatched
// block state root", and missing system contracts produce a state-diff shape
// mainnet never has. These tests pin the addresses and the code.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { BUILDERNET_GENESIS_ACCOUNTS, PAYMENT_FORWARDER_ADDRESS } from "./system-contracts.ts";

Deno.test("the five mainnet predeploys are present, at their mainnet addresses", () => {
  assertEquals(Object.keys(BUILDERNET_GENESIS_ACCOUNTS).length, 5);
  for (const addr of [
    PAYMENT_FORWARDER_ADDRESS,
    "0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02", // EIP-4788 beacon roots
    "0x0000F90827F1C53a10cb7A02335B175320002935", // EIP-2935 history storage
    "0x00000961Ef480Eb55e80D19ad83579A64c007002", // EIP-7002 withdrawal requests
    "0x0000BBdDc7CE488642fb579F8B00f3a590007251", // EIP-7251 consolidations
  ]) {
    assert(addr in BUILDERNET_GENESIS_ACCOUNTS, `${addr} is not predeployed`);
  }
});

Deno.test("PaymentForwarder carries mainnet's runtime code", () => {
  const a = BUILDERNET_GENESIS_ACCOUNTS[PAYMENT_FORWARDER_ADDRESS];
  assertEquals(a.code ?? "", "0x5f358060e01c4218600f5760401cff5b5f5ffd00");
  assertEquals(PAYMENT_FORWARDER_ADDRESS, "0xFEEEEEE44046c3f61a8CC081E0918eF0de0a7ffC");
});

Deno.test("every predeploy is a contract: nonce 1, zero balance, real code", () => {
  for (const [addr, a] of Object.entries(BUILDERNET_GENESIS_ACCOUNTS)) {
    assertEquals(a.nonce, "0x1", `${addr} must look like a deployed contract`);
    assertEquals(a.balance, "0x0", `${addr} must hold no ether`);
    const code = a.code ?? "";
    assert(code.startsWith("0x") && code.length > 10, `${addr} has no code`);
    assertEquals(code.length % 2, 0, `${addr} code is not whole bytes`);
  }
});
