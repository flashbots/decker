// images.json is the contract with external builders: every image a rendered
// recipe references, described in structured fields, next to the manifests.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("build: images.json describes every image the manifests reference", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["build", "rbuilder"], { cwd: root, env: { DECKER_ROOT: root } });
    assertEquals(r.code, 0, r.out);

    const images = JSON.parse(await Deno.readTextFile(join(root, "manifests", "rbuilder", "images.json")));
    const tags = Object.keys(images);
    assert(tags.length > 0, "recipe builds images, so images.json must not be empty");

    const rendered = await Deno.readTextFile(join(root, "manifests", "rbuilder", "podman.yaml"));
    for (const tag of tags) {
      assert(rendered.includes(tag), `${tag} is in images.json but nothing references it`);
      const spec = images[tag];
      assert(spec.repo && spec.ref, `${tag} must pin a repo and a ref`);
      assert(spec.cmd.includes("$ENGINE") && spec.cmd.includes("$IMAGE"), `${tag} cmd is not substitutable`);
      assert(spec.dockerfile || spec.assetDockerfile, `${tag} names no Dockerfile`);
    }
  });
});

Deno.test("build: a recipe with no source-built images still writes images.json", async () => {
  await withTmp(async (root) => {
    const r = await runDecker(["build", "contender-bench"], { cwd: root, env: { DECKER_ROOT: root } });
    assertEquals(r.code, 0, r.out);
    const path = join(root, "manifests", "contender-bench", "images.json");
    assertEquals(JSON.parse(await Deno.readTextFile(path)), {});
  });
});
