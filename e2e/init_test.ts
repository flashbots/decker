import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("init: writes a decker.ts into the current directory", async () => {
  await withTmp(async (cwd) => {
    const r = await runDecker(["init"], { cwd });
    assertEquals(r.code, 0, r.out);
    const body = await Deno.readTextFile(join(cwd, "decker.ts"));
    assertStringIncludes(body, "export const project");
  });
});

Deno.test("init: declining the overwrite prompt keeps the existing file", async () => {
  await withTmp(async (cwd) => {
    await Deno.writeTextFile(join(cwd, "decker.ts"), "// mine\n");
    const r = await runDecker(["init"], { cwd, stdin: "n\n" });
    assertEquals(r.code, 0, r.out);
    const body = await Deno.readTextFile(join(cwd, "decker.ts"));
    assert(body.includes("// mine"), "existing decker.ts must be preserved on decline");
  });
});
