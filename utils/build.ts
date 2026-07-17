import { basename, fromFileUrl, isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { emit } from "./emit.ts";
import type { Recipe, Script } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";
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

// Load standalone script modules (referenced by a decker.ts manifest or a
// --script flag). Each is wrapped and named after its file so the `scripts`
// section labels the run by filename instead of a generic "script".
export async function loadScripts(paths: string[]): Promise<Script[]> {
  const out: Script[] = [];
  for (const p of paths) {
    const path = await Deno.realPath(p);
    const mod = await import(toFileUrl(path).href);
    if (typeof mod.script !== "function") {
      throw new Error(`${p} must export 'script: Script'`);
    }
    const script: Script = (recipe) => mod.script(recipe);
    Object.defineProperty(script, "name", { value: basename(path).replace(/\.ts$/, "") });
    out.push(script);
  }
  return out;
}

export function artifactsHostPath(recipe: Recipe): string {
  const p = recipe.artifactsHostPath ?? "runtime/artifacts";
  return isAbsolute(p) ? p : join(DECKER_ROOT, p);
}

// A short "generator/fork" label for the `up`/`build`/`artifacts` status lines.
export function artifactsLabel(recipe: Recipe): string {
  const a = recipe.artifacts;
  if (!a) return "no artifacts";
  const fork = a.generator === "opstack" ? `${a.l1Fork}+${a.l2Fork}` : a.fork;
  return `${a.generator}/${fork}`;
}

export async function generateArtifacts(recipe: Recipe): Promise<void> {
  if (!recipe.artifacts) return;
  const out = artifactsHostPath(recipe);
  const { generator, ...spec } = recipe.artifacts;
  try {
    await Deno.remove(out, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Deno.mkdir(out, { recursive: true });
  const entry = new URL(`./${generator}/index.ts`, GENERATORS_DIR);
  let mod: { generate?: (opts: Record<string, unknown>) => Promise<unknown> };
  try {
    mod = await import(entry.href);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`unknown artifacts generator: ${generator}`);
    throw e;
  }
  if (typeof mod.generate !== "function") {
    throw new Error(`generators/${generator}/index.ts must export 'generate'`);
  }
  await mod.generate({ outDir: out, ...spec });
}

export async function buildOne(
  target: string,
): Promise<{ name: string; binaries: string[]; binaryBuilds: string[] }> {
  const { name, recipe } = await loadRecipe(target);
  const { binaries, binaryBuilds } = await emit(name, recipe);
  return { name, binaries, binaryBuilds: [...binaryBuilds.keys()] };
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
