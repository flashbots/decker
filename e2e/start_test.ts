import { assert } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

// A full launch is covered by launch_test.ts (podman-gated); `start` shares
// `up`'s emit/launch path. Here we only assert the no-infra contract.
Deno.test("start: unknown recipe fails non-zero", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["start", "no-such-recipe"], { cwd: root, env: { DECKER_ROOT: root } });
    assert(r.code !== 0, "should exit non-zero for an unknown recipe");
  });
});
