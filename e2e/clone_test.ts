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

// `clone` pulls flashbots/decker@main from GitHub, so it needs network. Gated
// to CI to keep the local/offline `deno test` run fast and dependency-free.
Deno.test({
  name: "clone: bootstraps the decker repo into an empty directory",
  ignore: !Deno.env.get("CI"),
  fn: async () => {
    await withTmp(async (cwd) => {
      const r = await runDecker(["clone"], { cwd });
      assertEquals(r.code, 0, r.out);
      assert(await exists(join(cwd, "cli.ts")), "cloned cli.ts should exist");
      assert(await exists(join(cwd, "README.md")), "cloned README.md should exist");
    });
  },
});

Deno.test({
  name: "clone: refuses when it would clobber existing files",
  ignore: !Deno.env.get("CI"),
  fn: async () => {
    await withTmp(async (cwd) => {
      await Deno.writeTextFile(join(cwd, "README.md"), "mine");
      const r = await runDecker(["clone"], { cwd });
      assert(r.code !== 0, "should refuse to overwrite existing files");
      assertEquals(await Deno.readTextFile(join(cwd, "README.md")), "mine");
    });
  },
});
