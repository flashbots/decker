import type { ImageBuildSpec, ImageEngine } from "./types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const CACHE_DIR = `${DECKER_ROOT}/cache/images`;

export function imageTag(spec: ImageBuildSpec): string {
  return `decker-${repoBasename(spec.repo)}:${slug(spec.ref)}`;
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
  await run(["git", "fetch", "origin", spec.ref], { cwd: cloneDir });
  await run(["git", "checkout", spec.ref], { cwd: cloneDir });
  await run(["git", "reset", "--hard", `origin/${spec.ref}`], { cwd: cloneDir });
  return cloneDir;
}

async function buildOne(tag: string, spec: ImageBuildSpec, engine: ImageEngine): Promise<void> {
  const cloneDir = await ensureClone(spec);
  await run(["sh", "-c", spec.cmd], {
    cwd: cloneDir,
    env: { ...Deno.env.toObject(), IMAGE: tag, ENGINE: engine },
  });
  if (!(await imageExists(tag, engine))) {
    throw new Error(`build for ${tag} ran but image is not present afterward`);
  }
}

export async function ensureImages(
  specs: Map<string, ImageBuildSpec>,
  engine: ImageEngine,
): Promise<string[]> {
  const built: string[] = [];
  for (const [tag, spec] of specs) {
    if (await imageExists(tag, engine)) continue;
    await buildOne(tag, spec, engine);
    built.push(tag);
  }
  return built;
}
