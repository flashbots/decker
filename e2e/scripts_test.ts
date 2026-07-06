import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { hasPodmanSocket, REPO_ROOT, runDecker, withTmp } from "./helpers.ts";

const FIXTURE = join(REPO_ROOT, "e2e", "fixtures", "minimal.ts");
const MARKER_SCRIPT = join(REPO_ROOT, "e2e", "fixtures", "marker-script.ts");

Deno.test("up: --script with a missing file fails cleanly", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["up", FIXTURE, "--script", "./does-not-exist.ts"], {
      cwd: root,
      env: { DECKER_ROOT: root },
    });
    assert(r.code !== 0, "should exit non-zero for a missing script");
  });
});

Deno.test("up: --script without a 'script' export fails cleanly", async () => {
  await withTmp(async (root) => {
    const bad = join(root, "bad-script.ts");
    await Deno.writeTextFile(bad, "export const notScript = 1;\n");
    const r = await runDecker(["up", FIXTURE, "--script", bad], { cwd: root, env: { DECKER_ROOT: root } });
    assert(r.code !== 0, "should exit non-zero when the script has no 'script' export");
    assertStringIncludes(r.out, "must export 'script");
  });
});

// Full happy path needs pods to actually start, so it's gated on podman like
// launch_test.ts.
Deno.test({
  name: "up/down: --script appends and runs a user script against the recipe",
  ignore: !(await hasPodmanSocket()),
  fn: async () => {
    await withTmp(async (root) => {
      const env = { DECKER_ROOT: root };
      const marker = join(root, "marker.json");
      try {
        const up = await runDecker(["up", FIXTURE, "--script", MARKER_SCRIPT], {
          cwd: root,
          env: { ...env, SCRIPT_MARKER_PATH: marker },
        });
        assertEquals(up.code, 0, up.out);
        const written = JSON.parse(await Deno.readTextFile(marker));
        assertEquals(written.pods, ["sleeper"]);
      } finally {
        const down = await runDecker(["down"], { cwd: root, env });
        assertEquals(down.code, 0, down.out);
      }
    });
  },
});

// The manifest's `scripts` survive the re-exec into the clone's CLI as --script
// flags, so this exercises the full project dispatch chain. The manifest's
// `into` points at the working tree itself (the "hack on the clone" dev flow —
// already cloned, never touched) so the test runs THIS checkout's code, not the
// committed ref a fresh clone would pin.
Deno.test({
  name: "up: manifest scripts are appended to the recipe and run",
  ignore: !(await hasPodmanSocket()),
  fn: async () => {
    await withTmp(async (root) => {
      const env = { DECKER_ROOT: root };
      await Deno.writeTextFile(
        join(root, "hello-script.ts"),
        `export const script = () => console.log("hello from manifest script");\n`,
      );
      const manifest = `export const project = {
  decker: { source: ${JSON.stringify(REPO_ROOT)}, ref: "main", into: ${JSON.stringify(REPO_ROOT)} },
  recipe: ${JSON.stringify(FIXTURE)},
  scripts: ["./hello-script.ts"],
};
`;
      await Deno.writeTextFile(join(root, "decker.ts"), manifest);
      try {
        const up = await runDecker(["up"], { cwd: root, env });
        assertEquals(up.code, 0, up.out);
        assertStringIncludes(up.out, "hello from manifest script");
        assertStringIncludes(up.out, "hello-script"); // labeled by filename
      } finally {
        const down = await runDecker(["down"], { cwd: root, env });
        assertEquals(down.code, 0, down.out);
      }
    });
  },
});
