import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("down: no-op when nothing is running", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["down"], { cwd: root, env: { DECKER_ROOT: root } });
    assertEquals(r.code, 0, r.out);
  });
});
