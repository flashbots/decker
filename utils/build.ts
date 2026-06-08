import { basename, fromFileUrl, isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { emit } from "./emit.ts";
import type { Recipe } from "./types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RECIPES_DIR = new URL("../recipes/", import.meta.url);
const GENERATORS_DIR = new URL("../generators/", import.meta.url);

export async function loadRecipe(target: string): Promise<{ name: string; recipe: Recipe }> {
  let path: string;
  let name: string;
  if (target.includes("/") || target.endsWith(".ts")) {
    path = await Deno.realPath(target);
    name = basename(path).replace(/\.ts$/, "");
  } else {
    path = await Deno.realPath(fromFileUrl(new URL(`${target}.ts`, RECIPES_DIR)));
    name = target;
  }
  const mod = await import(toFileUrl(path).href);
  if (!mod.recipe) throw new Error(`${path} must export 'recipe: Recipe'`);
  return { name, recipe: mod.recipe };
}

export function artifactsHostPath(recipe: Recipe): string {
  const p = recipe.artifactsHostPath ?? ".runtime/artifacts";
  return isAbsolute(p) ? p : join(DECKER_ROOT, p);
}

export async function generateArtifacts(recipe: Recipe): Promise<void> {
  const out = artifactsHostPath(recipe);
  try {
    await Deno.remove(out, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Deno.mkdir(out, { recursive: true });
  const entry = new URL(`./${recipe.artifacts}/index.ts`, GENERATORS_DIR);
  let mod: { generate?: (opts: { outDir: string }) => Promise<unknown> };
  try {
    mod = await import(entry.href);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`unknown artifacts generator: ${recipe.artifacts}`);
    throw e;
  }
  if (typeof mod.generate !== "function") {
    throw new Error(`generators/${recipe.artifacts}/index.ts must export 'generate'`);
  }
  await mod.generate({ outDir: out });
}

export async function buildOne(target: string): Promise<{ name: string; binaries: string[] }> {
  const { name, recipe } = await loadRecipe(target);
  const { binaries } = await emit(name, recipe);
  return { name, binaries };
}

export function missingBinaries(binaries: string[]): string[] {
  const missing: string[] = [];
  for (const b of binaries) {
    const resolved = b.replaceAll("${DECKER_ROOT}", DECKER_ROOT);
    if (resolved.includes("/")) {
      try {
        Deno.statSync(resolved);
      } catch {
        if (!missing.includes(b)) missing.push(b);
      }
    } else {
      if (!onPath(resolved) && !missing.includes(b)) missing.push(b);
    }
  }
  return missing;
}

function onPath(name: string): boolean {
  const path = Deno.env.get("PATH") ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    try {
      const stat = Deno.statSync(`${dir}/${name}`);
      if (stat.isFile) return true;
    } catch { /* keep looking */ }
  }
  return false;
}
