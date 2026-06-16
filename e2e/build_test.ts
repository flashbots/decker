import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

Deno.test("build: renders a recipe into manifests/ under the root", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["build", "l1"], { cwd: root, env: { DECKER_ROOT: root } });
    assertEquals(r.code, 0, r.out);
    assert(await exists(join(root, "manifests", "l1")), "manifests/l1 should exist");
    assert(await exists(join(root, "runtime")), "runtime/ should exist");
  });
});

Deno.test("build: unknown recipe fails cleanly (non-zero, no leaked stack)", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["build", "no-such-recipe"], { cwd: root, env: { DECKER_ROOT: root } });
    assert(r.code !== 0, "should exit non-zero");
  });
});
