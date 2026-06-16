import { assert, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("attach: clean error when there is no running runtime", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["attach"], { cwd: root, env: { DECKER_ROOT: root } });
    assert(r.code !== 0, "should exit non-zero with no runtime");
    assertStringIncludes(r.out.toLowerCase(), "no process-compose runtime");
  });
});
