import { basename, fromFileUrl, isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { emit } from "./emit.ts";
import type { Recipe, Script } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";
const RECIPES_DIR = new URL("../recipes/", import.meta.url);
const GENERATORS_DIR = new URL("../generators/", import.meta.url);

// Options passed to a factory recipe. From the CLI (`--opt k=v`) or a decker.ts
// `options` block, values arrive as strings; a factory called directly in TS may
// get richer types. Factories coerce as needed.
export type RecipeOptions = Record<string, unknown>;

export async function loadRecipe(
  target: string,
  options: RecipeOptions = {},
): Promise<{ name: string; recipe: Recipe }> {
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
  const exported = mod.recipe;
  if (exported === undefined) throw new Error(`${path} must export 'recipe' (a Recipe or (options) => Recipe)`);
  // A recipe is either a static value or a factory. Only factories take options;
  // handing options to a static recipe is a mistake, so surface it.
  if (typeof exported === "function") {
    return { name, recipe: (exported as (o: RecipeOptions) => Recipe)(options) };
  }
  if (Object.keys(options).length > 0) {
    throw new Error(`recipe ${name} takes no options (got: ${Object.keys(options).join(", ")})`);
  }
  return { name, recipe: exported as Recipe };
}

// A decker.ts manifest's `recipe` is either a name/path to resolve (as above) or
// an already-built Recipe value. A value is used as-is under a generic name;
// options only apply to a named factory recipe, so an inline recipe rejects them.
export async function resolveRecipe(
  recipe: string | Recipe,
  options: RecipeOptions = {},
): Promise<{ name: string; recipe: Recipe }> {
  if (typeof recipe === "string") return await loadRecipe(recipe, options);
  if (Object.keys(options).length > 0) {
    throw new Error(`an inline recipe takes no options (got: ${Object.keys(options).join(", ")})`);
  }
  return { name: "recipe", recipe };
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
  options: RecipeOptions = {},
): Promise<{ name: string; binaries: string[]; binaryBuilds: string[] }> {
  const { name, recipe } = await loadRecipe(target, options);
  const { binaries, binaryBuilds } = await emit(name, recipe);
  return { name, binaries, binaryBuilds: [...binaryBuilds.keys()] };
}

// Parse `--opt key=value` pairs (repeatable) into an options object.
export function parseOpts(pairs: string[] = []): RecipeOptions {
  const out: RecipeOptions = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq === -1) throw new Error(`bad --opt "${p}" (expected key=value)`);
    out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return out;
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
