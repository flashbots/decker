// Unit tests for the derived build command and the images.json payload: the
// two pieces external builders depend on byte-for-byte.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildCommand, imagesAssets, imagesManifest, imageTag } from "./image-build.ts";
import type { ImageBuildSpec } from "./types.ts";

const REPO = "https://github.com/flashbots/rbuilder-prism.git";

Deno.test("buildCommand: repo context with target and build args", () => {
  assertEquals(
    buildCommand({
      repo: REPO,
      ref: "abc",
      dockerfile: "docker/Dockerfile.rbuilder",
      target: "rbuilder-runtime",
      buildArgs: { RBUILDER_BIN: "rbuilder-operator-reth" },
    }),
    "$ENGINE build -f docker/Dockerfile.rbuilder --target rbuilder-runtime " +
      "--build-arg RBUILDER_BIN=rbuilder-operator-reth -t $IMAGE .",
  );
});

Deno.test("buildCommand: asset Dockerfile makes the repo the named context src", () => {
  assertEquals(
    buildCommand({ repo: REPO, ref: "abc", assetDockerfile: "flowproxy.Dockerfile", secrets: ["gh_token"] }),
    '$ENGINE build --build-context src=. -f "$DECKER_ROOT/_assets/flowproxy.Dockerfile" ' +
      '--secret id=gh_token,env=GH_TOKEN -t $IMAGE "$DECKER_ROOT/_assets"',
  );
});

Deno.test("buildCommand: default Dockerfile, and cmd overrides everything", () => {
  assertEquals(buildCommand({ repo: REPO, ref: "abc" }), "$ENGINE build -f Dockerfile -t $IMAGE .");
  assertEquals(buildCommand({ repo: REPO, ref: "abc", cmd: "custom" }), "custom");
});

Deno.test("imagesManifest: the human version travels beside the pinned ref", () => {
  const specs = new Map<string, ImageBuildSpec>([
    ["decker-rbuilder-operator-reth:abc", {
      repo: REPO,
      ref: "abc",
      name: "rbuilder-operator-reth",
      version: "v1.16.0",
      dockerfile: "docker/Dockerfile.rbuilder",
    }],
  ]);
  const got = JSON.parse(imagesManifest(specs));
  assertEquals(got["decker-rbuilder-operator-reth:abc"].version, "v1.16.0");
  assertEquals(imageTag(specs.get("decker-rbuilder-operator-reth:abc")!), "decker-rbuilder-operator-reth:abc");
});

Deno.test("imagesManifest: one entry per tag, name defaulted, cmd derived", () => {
  const specs = new Map<string, ImageBuildSpec>([
    ["decker-flowproxy:abc-v1", {
      repo: REPO,
      ref: "abc",
      name: "flowproxy",
      variant: "v1",
      assetDockerfile: "flowproxy.Dockerfile",
      assets: ["flowproxy-0001.patch"],
      secrets: ["gh_token"],
    }],
    ["decker-mev-boost-relay:main", {
      repo: "https://github.com/flashbots/mev-boost-relay.git",
      ref: "main",
      dockerfile: "Dockerfile",
    }],
  ]);
  const got = JSON.parse(imagesManifest(specs));
  assertEquals(Object.keys(got).sort(), ["decker-flowproxy:abc-v1", "decker-mev-boost-relay:main"]);
  assertEquals(got["decker-mev-boost-relay:main"].name, "mev-boost-relay");
  assertEquals(got["decker-flowproxy:abc-v1"].secrets, ["gh_token"]);
  assertEquals(
    got["decker-flowproxy:abc-v1"].cmd,
    buildCommand(specs.get("decker-flowproxy:abc-v1")!),
  );
  assertEquals(imagesAssets(specs), ["flowproxy-0001.patch", "flowproxy.Dockerfile"]);
});

Deno.test("imageTag: registry prefix, name and variant", () => {
  const spec: ImageBuildSpec = { repo: REPO, ref: "abc", name: "flowproxy", variant: "v1" };
  assertEquals(imageTag(spec), "decker-flowproxy:abc-v1");
});
