// Golden render of the buildernet-node recipe for k8s (pull mode). Pins every
// manifest byte-for-byte so a refactor that moves code cannot silently change
// what the cluster receives. Regenerate on purpose with UPDATE_GOLDEN=1.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { REPO_ROOT, runDecker, withTmp } from "./helpers.ts";

const GOLDEN_DIR = join(REPO_ROOT, "e2e", "fixtures", "buildernet-node-k8s");
const GOLDEN_IMAGES = join(REPO_ROOT, "e2e", "fixtures", "buildernet-node-images.json");
const RENDER_ENV = { DECKER_IMAGE_MODE: "pull", DECKER_IMAGE_REGISTRY: "localhost:30500" };

Deno.test("buildernet-node: k8s render matches the golden manifests", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["build", "buildernet-node", "--pods", "k8s"], {
      cwd: root,
      env: { DECKER_ROOT: root, ...RENDER_ENV },
    });
    assertEquals(r.code, 0, r.out);
    const dir = join(root, "manifests", "buildernet-node", "deploy");
    const names: string[] = [];
    for await (const e of Deno.readDir(dir)) if (e.isFile) names.push(e.name);
    names.sort();
    // images.json is the pin source of truth downstream builders read; a
    // changed ref must be a deliberate golden update, never a silent one.
    const images = await Deno.readTextFile(join(root, "manifests", "buildernet-node", "images.json"));
    if (Deno.env.get("UPDATE_GOLDEN") === "1") {
      await Deno.writeTextFile(GOLDEN_IMAGES, images);
      await Deno.mkdir(GOLDEN_DIR, { recursive: true });
      for await (const e of Deno.readDir(GOLDEN_DIR)) await Deno.remove(join(GOLDEN_DIR, e.name));
      for (const n of names) await Deno.copyFile(join(dir, n), join(GOLDEN_DIR, n));
      return;
    }
    const golden: string[] = [];
    for await (const e of Deno.readDir(GOLDEN_DIR)) if (e.isFile) golden.push(e.name);
    golden.sort();
    assertEquals(names, golden, "set of rendered manifests changed (UPDATE_GOLDEN=1 to accept)");
    assertEquals(
      images,
      await Deno.readTextFile(GOLDEN_IMAGES),
      "images.json differs from the golden pins (UPDATE_GOLDEN=1 to accept)",
    );
    for (const n of names) {
      assertEquals(
        await Deno.readTextFile(join(dir, n)),
        await Deno.readTextFile(join(GOLDEN_DIR, n)),
        `${n} differs from the golden render (UPDATE_GOLDEN=1 to accept)`,
      );
    }
  });
});
