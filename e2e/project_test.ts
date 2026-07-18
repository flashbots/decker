import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { lookup, registerPrototypes } from "../utils/resolve.ts";
import type { ContainerResult, ProcessResult } from "../utils/types.ts";
import { hasPodmanSocket, REPO_ROOT, runDecker, withTmp } from "./helpers.ts";

// --- registerPrototypes: the registry merge behind `prototypes` (unit level) ---

const bc = (): ContainerResult => ({ container: { image: "busybox:1.36" } });
const bp = (): ProcessResult => ({ process: { command: ["/bin/true"] } });

Deno.test("registerPrototypes: adds a new named prototype", () => {
  registerPrototypes({ pods: { "unit-new": { ports: { http: 1234 }, buildContainer: bc } } });
  const proto = lookup("unit-new");
  assertEquals(proto.ports.http, 1234);
  assert(proto.buildContainer === bc);
});

Deno.test("registerPrototypes: overrides one field of a built-in, keeps the rest", () => {
  const before = lookup("reth");
  assert(typeof before.buildProcess === "function", "reth ships a process builder to preserve");
  registerPrototypes({ pods: { reth: { ports: { rpc: 9 }, buildContainer: bc } } });
  const after = lookup("reth");
  assert(after.buildContainer === bc, "buildContainer is overridden");
  assertEquals(after.ports.rpc, 9);
  assert(after.buildProcess === before.buildProcess, "buildProcess is preserved by the field-wise merge");
});

Deno.test("registerPrototypes: the same name in pods and processes composes", () => {
  registerPrototypes({
    pods: { "unit-dual": { ports: {}, buildContainer: bc } },
    processes: { "unit-dual": { ports: {}, buildProcess: bp } },
  });
  const proto = lookup("unit-dual");
  assert(proto.buildContainer === bc);
  assert(proto.buildProcess === bp);
});

// --- end to end: a manifest's inline recipe and prototype overrides reach the
// launch. `into` points at the working tree (already cloned, never touched) so
// the child CLI runs THIS checkout. Gated on podman like the other launch tests.

const inlineProto =
  `{ ports: {}, buildContainer: () => ({ container: { image: "busybox:1.36", command: ["sh", "-c"], args: ["sleep 3600"] } }) }`;

Deno.test({
  name: "up: an inline Recipe value in the manifest launches",
  ignore: !(await hasPodmanSocket()),
  fn: async () => {
    await withTmp(async (root) => {
      const env = { DECKER_ROOT: root };
      const manifest = `export const project = {
  decker: { source: ${JSON.stringify(REPO_ROOT)}, ref: "main", into: ${JSON.stringify(REPO_ROOT)} },
  recipe: {
    pods: [{ name: "sleeper", containers: [{ name: "sleeper", prototype: ${inlineProto} }] }],
  },
};
`;
      await Deno.writeTextFile(join(root, "decker.ts"), manifest);
      try {
        const up = await runDecker(["up"], { cwd: root, env });
        assertEquals(up.code, 0, up.out);
        assert(up.out.includes("sleeper"), up.out);
      } finally {
        const down = await runDecker(["down"], { cwd: root, env });
        assertEquals(down.code, 0, down.out);
      }
    });
  },
});

Deno.test({
  name: "up: a manifest prototype supplies a name the recipe resolves",
  ignore: !(await hasPodmanSocket()),
  fn: async () => {
    await withTmp(async (root) => {
      const env = { DECKER_ROOT: root };
      // The recipe references "manifest-sleeper" by name; it exists only because
      // the manifest's `prototypes` registers it. A missing registration would
      // fail with `unknown prototype manifest-sleeper`.
      const manifest = `export const project = {
  decker: { source: ${JSON.stringify(REPO_ROOT)}, ref: "main", into: ${JSON.stringify(REPO_ROOT)} },
  recipe: {
    pods: [{ name: "sleeper", containers: [{ name: "sleeper", prototype: "manifest-sleeper" }] }],
  },
  prototypes: {
    pods: { "manifest-sleeper": ${inlineProto} },
  },
};
`;
      await Deno.writeTextFile(join(root, "decker.ts"), manifest);
      try {
        const up = await runDecker(["up"], { cwd: root, env });
        assertEquals(up.code, 0, up.out);
      } finally {
        const down = await runDecker(["down"], { cwd: root, env });
        assertEquals(down.code, 0, down.out);
      }
    });
  },
});
