import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { runDecker, withTmp, writeLocalManifest } from "./helpers.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

Deno.test("dispatch: a command auto-clones the source on first run", async () => {
  await withTmp(async (cwd) => {
    await writeLocalManifest(cwd);
    // No .decker yet — running any non-carved command should clone then run.
    const r = await runDecker(["recipes"], { cwd });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out.toLowerCase(), "cloning");
    assert(await exists(join(cwd, ".decker", "cli.ts")), "auto-pull should create .decker");
    assertStringIncludes(r.out, "l1"); // re-exec'd into the clone and ran
  });
});

Deno.test("dispatch: an existing clone is reused, not re-cloned", async () => {
  await withTmp(async (cwd) => {
    await writeLocalManifest(cwd);
    await runDecker(["recipes"], { cwd }); // first run clones
    const wip = join(cwd, ".decker", "WIP.txt");
    await Deno.writeTextFile(wip, "wip");

    const r = await runDecker(["recipes"], { cwd });
    assertEquals(r.code, 0, r.out);
    assert(!r.out.toLowerCase().includes("cloning"), "should not re-clone an existing clone");
    assert(await exists(wip), "existing clone (and WIP) must be left intact");
  });
});
