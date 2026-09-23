# Images

A container can name a published image, or pin a source repo and let decker
build it.

A pinned build is described in fields — repo, ref, Dockerfile, target, build
args, secrets — and the build command is derived from them. `cmd` remains as an
escape hatch for a build no combination of fields expresses.

```ts
function image(def: ContainerDef): ImageBuildSpec {
  return {
    repo: "https://github.com/flashbots/mev-boost-relay.git",
    ref: def.config?.ref as string ?? "main",
    dockerfile: "Dockerfile",
  };
}
```

## images.json

`decker build` writes every spec to `manifests/<recipe>/images.json`, beside
the rendered manifests and keyed by the exact tag those manifests reference:

```json
{
  "decker-mev-boost-relay:main": {
    "repo": "https://github.com/flashbots/mev-boost-relay.git",
    "ref": "main",
    "name": "mev-boost-relay",
    "dockerfile": "Dockerfile",
    "cmd": "$ENGINE build -f Dockerfile -t $IMAGE ."
  }
}
```

Run the images locally and decker builds whatever is missing. Set
`DECKER_IMAGE_MODE=pull` and it builds nothing at all, so CI or an in-cluster
build system can supply them — reading this one file instead of keeping a
second copy of your pins, which is the copy that drifts.
`DECKER_IMAGE_REGISTRY` prefixes the tags so the rendered manifests point at
the registry those images were pushed to.

## Build assets

Some builds need files the source repo does not have: a Dockerfile that patches
it, the patches it applies. Name them in `assetDockerfile` and `assets`. The
repo then arrives as the named build context `src` instead of being the build
context, which is how a Dockerfile outside the repo reaches its sources.

They live in decker's `_assets/`, or in your own repo — set `assetsDir` and a
recipe that lives outside decker ships its own build inputs:

```ts
const ASSETS_DIR = new URL("../_assets/", import.meta.url).href;

export const IMAGE: ImageBuildSpec = {
  repo: "https://github.com/example/thing.git",
  ref: "…",
  assetsDir: ASSETS_DIR,
  assetDockerfile: "thing.Dockerfile",
  assets: ["0001-some.patch"],
  variant: assetsVariant(["thing.Dockerfile", "0001-some.patch"], ASSETS_DIR),
  secrets: ["gh_token"],
};
```

Asset bytes hash into the image tag through `variant`, so a patched image can
never collide with a pristine build of the same ref, and moving the files
between repos does not change the tag. `decker build` copies them to
`manifests/<recipe>/images-assets/` for whoever does the building.

Secrets are passed as `--secret id=<id>,env=<ID>` and read from the environment
at build time; nothing is baked into the image.
