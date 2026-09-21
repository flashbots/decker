import type { ImageBuildSpec, ImageEngine } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";
const CACHE_DIR = `${DECKER_ROOT}/cache/images`;

// DECKER_IMAGE_REGISTRY: when set, images built from ImageBuildSpecs are
// tagged (and referenced by renderers) under this registry prefix, e.g.
// registry.example.svc:5000 -> registry.example.svc:5000/decker-foo:main.
// This is what lets rendered manifests run on a real (non-local) cluster:
// nodes pull from the registry instead of a local image store / kind load.
// DECKER_IMAGE_MODE: "build" (default) builds missing images locally;
// "pull" skips building entirely - an external builder (CI or an in-cluster
// build system) supplies the images, decker only references them.
export function imageRegistry(): string {
  return (Deno.env.get("DECKER_IMAGE_REGISTRY") ?? "").replace(/\/+$/, "");
}

export function imagePullMode(): boolean {
  return Deno.env.get("DECKER_IMAGE_MODE") === "pull";
}

export function imageTag(spec: ImageBuildSpec): string {
  const tag = slug(spec.ref) + (spec.variant ? `-${slug(spec.variant)}` : "");
  const base = `decker-${spec.name ? slug(spec.name) : repoBasename(spec.repo)}:${tag}`;
  const reg = imageRegistry();
  return reg ? `${reg}/${base}` : base;
}

// assetsVariant hashes decker-owned build inputs under _assets/ (a Dockerfile,
// patches) into a short tag suffix: FNV-1a 64 over the files' bytes in the
// given order, first 12 hex chars. ALP mirrors this exact scheme (Go
// hash/fnv) so its in-cluster builds produce the same tags decker's
// pull-mode manifests reference. Assets are read relative to this module
// (bundled into the compiled binary via `make compile`), not DECKER_ROOT,
// which is the runtime directory and need not hold the repo.
const ASSETS_DIR = new URL("../_assets/", import.meta.url);

export function assetsVariant(files: string[]): string {
  let h = 0xcbf29ce484222325n;
  for (const f of files) {
    const bytes = Deno.readFileSync(new URL(f, ASSETS_DIR));
    for (const b of bytes) {
      h ^= BigInt(b);
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  }
  return h.toString(16).padStart(16, "0").slice(0, 12);
}

// buildCommand derives the docker/podman build line from the spec's structured
// fields. Two shapes:
//   - repo context: the cloned repo is the build context, Dockerfile inside it.
//   - asset Dockerfile: _assets is the context and the repo comes in as the
//     named context `src`, so a decker-owned Dockerfile can patch repo sources.
// $ENGINE/$IMAGE/$DECKER_ROOT are substituted by the caller's environment.
export function buildCommand(spec: ImageBuildSpec): string {
  if (spec.cmd) return spec.cmd;
  const args = ["$ENGINE", "build"];
  if (spec.assetDockerfile) {
    args.push("--build-context", "src=.", "-f", `"$DECKER_ROOT/_assets/${spec.assetDockerfile}"`);
  } else {
    args.push("-f", spec.dockerfile ?? "Dockerfile");
  }
  if (spec.target) args.push("--target", spec.target);
  for (const [k, v] of Object.entries(spec.buildArgs ?? {})) args.push("--build-arg", `${k}=${v}`);
  for (const id of spec.secrets ?? []) args.push("--secret", `id=${id},env=${id.toUpperCase()}`);
  args.push("-t", "$IMAGE", spec.assetDockerfile ? '"$DECKER_ROOT/_assets"' : ".");
  return args.join(" ");
}

// imagesManifest is what `build` writes next to the manifests as images.json:
// every image the recipe references, keyed by the tag the manifests use, with
// the build described in full. An external builder (ALP's in-cluster buildkit)
// reads this instead of keeping its own copy of the pins.
export function imagesManifest(specs: Map<string, ImageBuildSpec>): string {
  const out: Record<string, unknown> = {};
  for (const [tag, spec] of [...specs].sort(([a], [b]) => a < b ? -1 : 1)) {
    out[tag] = {
      repo: spec.repo,
      ref: spec.ref,
      name: spec.name ?? repoBasename(spec.repo),
      ...(spec.variant ? { variant: spec.variant } : {}),
      ...(spec.version ? { version: spec.version } : {}),
      ...(spec.assetDockerfile
        ? { assetDockerfile: spec.assetDockerfile }
        : { dockerfile: spec.dockerfile ?? "Dockerfile" }),
      ...(spec.assets?.length ? { assets: spec.assets } : {}),
      ...(spec.target ? { target: spec.target } : {}),
      ...(spec.buildArgs ? { buildArgs: spec.buildArgs } : {}),
      ...(spec.secrets?.length ? { secrets: spec.secrets } : {}),
      cmd: buildCommand(spec),
    };
  }
  return JSON.stringify(out, null, 2) + "\n";
}

// Every _assets file a set of specs depends on: what an external builder must
// receive alongside images.json.
export function imagesAssets(specs: Map<string, ImageBuildSpec>): string[] {
  const files = new Set<string>();
  for (const spec of specs.values()) {
    if (spec.assetDockerfile) files.add(spec.assetDockerfile);
    for (const a of spec.assets ?? []) files.add(a);
  }
  return [...files].sort();
}

export function assetFile(name: string): Uint8Array {
  return Deno.readFileSync(new URL(name, ASSETS_DIR));
}

function repoBasename(repo: string): string {
  const last = repo.replace(/\.git$/, "").replace(/\/$/, "").split("/").pop() ?? repo;
  return slug(last);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function imageExists(tag: string, engine: ImageEngine): Promise<boolean> {
  const args = engine === "podman" ? ["image", "exists", tag] : ["image", "inspect", tag];
  const proc = await new Deno.Command(engine, {
    args,
    stdout: "null",
    stderr: "null",
  }).output();
  return proc.code === 0;
}

async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<void> {
  const proc = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts.cwd,
    env: opts.env,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (proc.code !== 0) throw new Error(`${cmd.join(" ")} exited with code ${proc.code}`);
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function ensureClone(spec: ImageBuildSpec): Promise<string> {
  const cloneDir = `${CACHE_DIR}/${repoBasename(spec.repo)}`;
  await Deno.mkdir(CACHE_DIR, { recursive: true });
  if (!(await dirExists(`${cloneDir}/.git`))) {
    try {
      await Deno.remove(cloneDir, { recursive: true });
    } catch { /* fine */ }
    await run(["git", "clone", spec.repo, cloneDir]);
  }
  // Branches, tags AND commit SHAs: fetch the ref itself and check out what
  // arrived. `reset --hard origin/<ref>` only ever existed for branches.
  await run(["git", "fetch", "--force", "origin", spec.ref], { cwd: cloneDir });
  await run(["git", "checkout", "--force", "--detach", "FETCH_HEAD"], { cwd: cloneDir });
  return cloneDir;
}

async function buildOne(tag: string, spec: ImageBuildSpec, engine: ImageEngine): Promise<void> {
  const cloneDir = await ensureClone(spec);
  await run(["sh", "-c", buildCommand(spec)], {
    cwd: cloneDir,
    env: { ...Deno.env.toObject(), IMAGE: tag, ENGINE: engine, DECKER_ROOT },
  });
  if (!(await imageExists(tag, engine))) {
    throw new Error(`build for ${tag} ran but image is not present afterward`);
  }
}

export async function ensureImages(
  specs: Map<string, ImageBuildSpec>,
  engine: ImageEngine,
): Promise<string[]> {
  // pull mode: the registry already holds the images (external builder);
  // nothing to do locally and no image engine is required.
  if (imagePullMode()) return [];
  const built: string[] = [];
  for (const [tag, spec] of specs) {
    if (await imageExists(tag, engine)) continue;
    await buildOne(tag, spec, engine);
    built.push(tag);
  }
  return built;
}
