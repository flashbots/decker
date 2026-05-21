import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { bold, cyan, dim, green, ms, red } from "./term.ts";

export type DeckerProject = {
  decker: {
    source?: string;
    ref?: string;
    into?: string;
  };
  recipe: string;
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

export async function clone(p: DeckerProject): Promise<void> {
  const src = p.decker.source;
  if (!src) throw new Error("decker.source required to clone");
  const ref = p.decker.ref ?? "main";
  const dst = intoDir(p);
  console.log(`${dim("→")} cloning ${bold(src)}${dim(`@${ref}`)} → ${cyan(dst)}`);
  const t0 = performance.now();
  const { code } = await new Deno.Command("git", {
    args: ["clone", "--depth", "1", "--branch", ref, src, dst],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (code !== 0) {
    console.error(red("✗ git clone failed"));
    throw new Error("clone failed");
  }
  console.log(`${green("✓")} cloned ${dim(`(${ms(t0)})`)}`);
}

export async function ensureClone(p: DeckerProject): Promise<string> {
  if (!await isCloned(p)) await clone(p);
  return intoDir(p);
}
