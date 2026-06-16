import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("recipes: lists the bundled recipes", async () => {
  await withTmp(async (cwd) => {
    const r = await runDecker(["recipes"], { cwd });
    assertEquals(r.code, 0);
    assertStringIncludes(r.out, "l1");
    assertStringIncludes(r.out, "example");
  });
});
