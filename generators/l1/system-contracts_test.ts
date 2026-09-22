// The EL calls these contracts every block; missing code silently produces a
// state-diff shape mainnet never has. Pin the addresses and the code.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { MAINNET_SYSTEM_CONTRACTS, predeploy, SYSTEM_CONTRACT_ADDRESSES } from "./system-contracts.ts";

Deno.test("the four system contracts are present, at their mainnet addresses", () => {
  assertEquals(Object.keys(MAINNET_SYSTEM_CONTRACTS).length, 4);
  for (const addr of Object.values(SYSTEM_CONTRACT_ADDRESSES)) {
    assert(addr in MAINNET_SYSTEM_CONTRACTS, `${addr} is not predeployed`);
  }
});

Deno.test("every predeploy is a contract: nonce 1, zero balance, real code", () => {
  for (const [addr, a] of Object.entries(MAINNET_SYSTEM_CONTRACTS)) {
    assertEquals(a.nonce, "0x1", `${addr} must look like a deployed contract`);
    assertEquals(a.balance, "0x0", `${addr} must hold no ether`);
    const code = a.code ?? "";
    assert(code.startsWith("0x") && code.length > 10, `${addr} has no code`);
    assertEquals(code.length % 2, 0, `${addr} code is not whole bytes`);
  }
});

Deno.test("predeploy() shapes a recipe's own contract the same way", () => {
  assertEquals(predeploy("0xfeed"), { nonce: "0x1", balance: "0x0", code: "0xfeed" });
});
