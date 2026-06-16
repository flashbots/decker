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

Deno.test("pull: clones the pinned source into .decker", async () => {
  await withTmp(async (cwd) => {
    await writeLocalManifest(cwd);
    const r = await runDecker(["pull"], { cwd });
    assertEquals(r.code, 0, r.out);
    assert(await exists(join(cwd, ".decker", "cli.ts")), ".decker clone should exist");
  });
});

Deno.test("pull: never overwrites an existing clone (protects WIP)", async () => {
  await withTmp(async (cwd) => {
    await writeLocalManifest(cwd);
    const first = await runDecker(["pull"], { cwd });
    assertEquals(first.code, 0, first.out);

    const wip = join(cwd, ".decker", "WIP.txt");
    await Deno.writeTextFile(wip, "work in progress");

    const second = await runDecker(["pull"], { cwd });
    assertEquals(second.code, 0, second.out);
    assertStringIncludes(second.out.toLowerCase(), "already exists");
    assert(await exists(wip), "WIP file must survive a repeated pull");
  });
});
