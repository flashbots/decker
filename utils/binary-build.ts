import { basename, dirname } from "jsr:@std/path@^1.0.0";
import type { BinaryBuildSpec } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";
const BIN_CACHE = `${DECKER_ROOT}/cache/bins`;
const SRC_CACHE = `${DECKER_ROOT}/cache/sources`;

// Stable location of the built binary. Returned with a literal ${DECKER_ROOT}
// placeholder so it can be embedded in rendered manifests (materializeRuntime
// expands it on the way to runtime/); ensureBinaries expands it back to build.
export function binaryBuildPath(spec: BinaryBuildSpec): string {
  return `\${DECKER_ROOT}/cache/bins/${relDir(spec)}/${basename(spec.artifact)}`;
}

function outputPath(spec: BinaryBuildSpec): string {
  return `${BIN_CACHE}/${relDir(spec)}/${basename(spec.artifact)}`;
}

function relDir(spec: BinaryBuildSpec): string {
  return `${repoBasename(spec.repo)}-${slug(spec.ref)}`;
}

function repoBasename(repo: string): string {
  const last = repo.replace(/\.git$/, "").replace(/\/$/, "").split("/").pop() ?? repo;
  return slug(last);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function run(cmd: string[], opts: { cwd?: string } = {}): Promise<void> {
  const proc = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts.cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (proc.code !== 0) throw new Error(`${cmd.join(" ")} exited with code ${proc.code}`);
}

async function ensureClone(spec: BinaryBuildSpec): Promise<string> {
  const cloneDir = `${SRC_CACHE}/${repoBasename(spec.repo)}`;
  await Deno.mkdir(SRC_CACHE, { recursive: true });
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

async function buildOne(spec: BinaryBuildSpec): Promise<void> {
  const cloneDir = await ensureClone(spec);
  await run(["sh", "-c", spec.cmd], { cwd: cloneDir });
  const artifact = `${cloneDir}/${spec.artifact}`;
  if (!(await exists(artifact))) {
    throw new Error(`build for ${basename(spec.artifact)} ran but ${spec.artifact} is missing`);
  }
  const out = outputPath(spec);
  await Deno.mkdir(dirname(out), { recursive: true });
  await Deno.copyFile(artifact, out);
  await Deno.chmod(out, 0o755);
}

export async function ensureBinaries(
  specs: Map<string, BinaryBuildSpec>,
): Promise<string[]> {
  const built: string[] = [];
  for (const spec of specs.values()) {
    if (await exists(outputPath(spec))) continue;
    await buildOne(spec);
    built.push(outputPath(spec));
  }
  return built;
}
