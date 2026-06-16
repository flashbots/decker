import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("artifacts: generates a recipe's artifacts under the root", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["artifacts", "l1"], { cwd: root, env: { DECKER_ROOT: root } });
    assertEquals(r.code, 0, r.out);
    const dir = join(root, "runtime", "artifacts");
    const entries = [];
    for await (const e of Deno.readDir(dir)) entries.push(e.name);
    assert(entries.length > 0, `expected generated artifacts in ${dir}`);
  });
});

Deno.test("artifacts: missing target argument fails", async () => {
  await withTmp(async (cwd) => {
    const r = await runDecker(["artifacts"], { cwd });
    assert(r.code !== 0, "should exit non-zero when target is missing");
  });
});
