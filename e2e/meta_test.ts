import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("version: -V and --version produce identical output", async () => {
  await withTmp(async (cwd) => {
    const short = await runDecker(["-V"], { cwd });
    const long = await runDecker(["--version"], { cwd });
    assertEquals(short.code, 0);
    assertEquals(long.code, 0);
    assertEquals(short.stdout.trim(), long.stdout.trim());
  });
});

Deno.test("help: bare invocation lists commands", async () => {
  await withTmp(async (cwd) => {
    const r = await runDecker([], { cwd });
    assertEquals(r.code, 0);
    assertStringIncludes(r.out, "clone");
    assertStringIncludes(r.out, "init");
    assertStringIncludes(r.out.toLowerCase(), "deck your own devnet");
  });
});

Deno.test("unknown command: renders help and exits 2", async () => {
  await withTmp(async (cwd) => {
    const r = await runDecker(["definitely-not-a-command"], { cwd });
    assertEquals(r.code, 2);
    assertStringIncludes(r.out.toLowerCase(), "unknown command");
    assertStringIncludes(r.out, "clone"); // full help body is present
  });
});
