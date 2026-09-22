// Unit tests for the derived build command and the images.json payload: the
// two pieces external builders depend on byte-for-byte.
import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { assetsRoot, assetsVariant, buildCommand, imagesAssets, imagesManifest, imageTag } from "./image-build.ts";
import type { ImageBuildSpec } from "./types.ts";

const REPO = "https://github.com/flashbots/reth.git";

Deno.test("buildCommand: repo context with target and build args", () => {
  assertEquals(
    buildCommand({
      repo: REPO,
      ref: "abc",
      dockerfile: "docker/Dockerfile.node",
      target: "runtime",
      buildArgs: { FEATURES: "jemalloc" },
    }),
    "$ENGINE build -f docker/Dockerfile.node --target runtime " +
      "--build-arg FEATURES=jemalloc -t $IMAGE .",
  );
});

Deno.test("buildCommand: asset Dockerfile makes the repo the named context src", () => {
  assertEquals(
    buildCommand({ repo: REPO, ref: "abc", assetDockerfile: "node.Dockerfile", secrets: ["gh_token"] }),
    '$ENGINE build --build-context src=. -f "$ASSETS/node.Dockerfile" ' +
      '--secret id=gh_token,env=GH_TOKEN -t $IMAGE "$ASSETS"',
  );
});

Deno.test("buildCommand: default Dockerfile, and cmd overrides everything", () => {
  assertEquals(buildCommand({ repo: REPO, ref: "abc" }), "$ENGINE build -f Dockerfile -t $IMAGE .");
  assertEquals(buildCommand({ repo: REPO, ref: "abc", cmd: "custom" }), "custom");
});

Deno.test("imagesManifest: the human version travels beside the pinned ref", () => {
  const specs = new Map<string, ImageBuildSpec>([
    ["decker-reth:abc", {
      repo: REPO,
      ref: "abc",
      name: "reth",
      version: "v1.16.0",
      dockerfile: "docker/Dockerfile.node",
    }],
  ]);
  const got = JSON.parse(imagesManifest(specs));
  assertEquals(got["decker-reth:abc"].version, "v1.16.0");
  assertEquals(imageTag(specs.get("decker-reth:abc")!), "decker-reth:abc");
});

Deno.test("imagesManifest: one entry per tag, name defaulted, cmd derived", () => {
  const specs = new Map<string, ImageBuildSpec>([
    ["decker-reth:abc-v1", {
      repo: REPO,
      ref: "abc",
      name: "reth",
      variant: "v1",
      assetDockerfile: "node.Dockerfile",
      assets: ["node-0001.patch"],
      secrets: ["gh_token"],
    }],
    ["decker-mev-boost-relay:main", {
      repo: "https://github.com/flashbots/mev-boost-relay.git",
      ref: "main",
      dockerfile: "Dockerfile",
    }],
  ]);
  const got = JSON.parse(imagesManifest(specs));
  assertEquals(Object.keys(got).sort(), ["decker-mev-boost-relay:main", "decker-reth:abc-v1"]);
  assertEquals(got["decker-mev-boost-relay:main"].name, "mev-boost-relay");
  assertEquals(got["decker-reth:abc-v1"].secrets, ["gh_token"]);
  assertEquals(got["decker-reth:abc-v1"].cmd, buildCommand(specs.get("decker-reth:abc-v1")!));
  assertEquals(imagesAssets(specs), [
    { name: "node-0001.patch", dir: undefined },
    { name: "node.Dockerfile", dir: undefined },
  ]);
});

Deno.test("imageTag: name and variant", () => {
  const spec: ImageBuildSpec = { repo: REPO, ref: "abc", name: "reth", variant: "v1" };
  assertEquals(imageTag(spec), "decker-reth:abc-v1");
});

// A recipe living outside decker (its own repo, private or not) declares specs
// whose Dockerfile and patches sit in ITS tree. assetsDir is how those files are
// found, hashed into the tag, and shipped next to images.json.
Deno.test("assetsDir: an out-of-tree recipe owns its build assets", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/my.Dockerfile`, "FROM scratch\n");
  await Deno.writeTextFile(`${dir}/0001.patch`, "diff\n");

  const spec: ImageBuildSpec = {
    repo: REPO,
    ref: "abc",
    name: "mine",
    assetsDir: dir,
    assetDockerfile: "my.Dockerfile",
    assets: ["0001.patch"],
  };
  spec.variant = assetsVariant(["my.Dockerfile", "0001.patch"], dir);

  assertEquals(spec.variant.length, 12);
  assertEquals(imageTag(spec), `decker-mine:abc-${spec.variant}`);
  assertEquals(imagesAssets(new Map([["t", spec]])), [
    { name: "0001.patch", dir },
    { name: "my.Dockerfile", dir },
  ]);
  // The build line stays dir-agnostic: $ASSETS is resolved when the build runs.
  assertEquals(
    buildCommand(spec),
    '$ENGINE build --build-context src=. -f "$ASSETS/my.Dockerfile" -t $IMAGE "$ASSETS"',
  );
  assertEquals(assetsRoot(dir).href, assetsRoot(`${dir}/`).href);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("assetsVariant: same bytes, same suffix; changed bytes, new suffix", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a`, "one");
  const first = assetsVariant(["a"], dir);
  assertEquals(assetsVariant(["a"], dir), first);
  await Deno.writeTextFile(`${dir}/a`, "two");
  assertEquals(assetsVariant(["a"], dir) === first, false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("imagesAssets: one filename cannot mean two files", () => {
  const specs = new Map<string, ImageBuildSpec>([
    ["a", { repo: REPO, ref: "1", assetDockerfile: "x.Dockerfile" }],
    ["b", { repo: REPO, ref: "2", assetDockerfile: "x.Dockerfile", assetsDir: "/tmp/elsewhere" }],
  ]);
  assertThrows(() => imagesAssets(specs), Error, "two directories");
});
