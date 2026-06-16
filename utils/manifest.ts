import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { done, fail, step } from "./term.ts";

export type DeckerProject = {
  decker: {
    source: string;
    ref: string;
    into?: string;
  };
  recipe: string;
  target?: {
    pods?: string;
    processes?: string;
  };
};

export type Manifest = {
  path: string;
  project: DeckerProject;
};

export const DEFAULT_MANIFEST = "decker.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadManifest(path: string): Promise<Manifest> {
  const abs = isAbsolute(path) ? path : join(Deno.cwd(), path);
  if (!await exists(abs)) {
    throw new Error(`manifest not found: ${path}`);
  }
  const real = await Deno.realPath(abs);
  const mod = await import(toFileUrl(real).href);
  if (!mod.project) {
    throw new Error(`${path} must export 'project: DeckerProject'`);
  }
  return { path: real, project: mod.project };
}

export function intoDir(p: DeckerProject): string {
  const into = p.decker.into ?? ".decker";
  return isAbsolute(into) ? into : join(Deno.cwd(), into);
}

export async function isCloned(p: DeckerProject): Promise<boolean> {
  return await exists(join(intoDir(p), "cli.ts"));
}

async function head(dir: string): Promise<string> {
  const { code, stdout } = await new Deno.Command("git", {
    args: ["-C", dir, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`git rev-parse failed in ${dir}`);
  return new TextDecoder().decode(stdout).trim();
}

async function resolveRef(dir: string, ref: string): Promise<string> {
  for (const candidate of [ref, `origin/${ref}`]) {
    const { code, stdout } = await new Deno.Command("git", {
      args: ["-C", dir, "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (code === 0) return new TextDecoder().decode(stdout).trim();
  }
  throw new Error(`cannot resolve ref ${ref} in ${dir}`);
}

async function checkoutDetached(dir: string, ref: string): Promise<void> {
  const commit = await resolveRef(dir, ref);
  const { code, stderr } = await new Deno.Command("git", {
    args: ["-C", dir, "checkout", "--quiet", "--detach", commit],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    await Deno.stderr.write(stderr);
    throw new Error(`git checkout ${ref} failed`);
  }
}

// Clone the pinned source into the manifest's `into` dir and detach at `ref`.
// Assumes the clone does not yet exist — callers must guard with `isCloned`, as
// an existing clone is never modified (it may hold the user's local changes).
export async function pull(p: DeckerProject): Promise<string> {
  const src = p.decker.source;
  const ref = p.decker.ref;
  if (!src) throw new Error("decker.source required");
  if (!ref) throw new Error("decker.ref required");
  const dst = intoDir(p);

  const sp = step(`cloning ${src}`);
  const { code, stderr } = await new Deno.Command("git", {
    args: ["clone", "--quiet", src, dst],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    fail(sp, "git clone failed");
    await Deno.stderr.write(stderr);
    throw new Error("clone failed");
  }
  done(sp, dst);

  const spC = step(`checking out ${ref}`);
  try {
    await checkoutDetached(dst, ref);
  } catch (e) {
    fail(spC, (e as Error).message);
    throw e;
  }
  done(spC, (await head(dst)).slice(0, 12));
  return dst;
}

// The clone, once present, is the user's working copy — used as-is regardless
// of its current commit. The `ref` pin only applies when cloning from scratch
// (see `pull`); we don't re-enforce it here so local changes survive.
export async function ensureClone(p: DeckerProject): Promise<string> {
  const dst = intoDir(p);
  if (!await isCloned(p)) {
    throw new Error(`${dst} not present — run \`decker pull\` first`);
  }
  return dst;
}
