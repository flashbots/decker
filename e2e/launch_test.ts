import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { has, REPO_ROOT, runDecker, withTmp } from "./helpers.ts";

const FIXTURE = join(REPO_ROOT, "e2e", "fixtures", "minimal.ts");

// A real launch needs podman (the default pods renderer). Skipped when podman
// is absent so local `deno test` and forks stay green; CI runs it.
Deno.test({
  name: "up/down: launches and tears down a minimal busybox pod",
  ignore: !(await has("podman")),
  fn: async () => {
    await withTmp(async (root) => {
      const env = { DECKER_ROOT: root };
      try {
        const up = await runDecker(["up", FIXTURE], { cwd: root, env });
        assertEquals(up.code, 0, up.out);
      } finally {
        const down = await runDecker(["down"], { cwd: root, env });
        assertEquals(down.code, 0, down.out);
      }
    });
  },
});
