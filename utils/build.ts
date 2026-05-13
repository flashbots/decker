import { basename, fromFileUrl, isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { emit } from "./emit.ts";
import type { Recipe } from "./types.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const RECIPES_DIR = new URL("../recipes/", import.meta.url);

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
  const p = recipe.artifactsHostPath ?? "artifacts";
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

export async function generateArtifacts(recipe: Recipe) {
  const out = artifactsHostPath(recipe);
  try {
    await Deno.remove(out, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return await new Deno.Command("builder-playground", {
    args: ["start", recipe.artifacts, "--dry-run", "--output", out],
    stdout: "piped",
    stderr: "inherit",
  }).output();
}

export async function buildOne(target: string): Promise<string> {
  const { name, recipe } = await loadRecipe(target);
  await emit(name, recipe);
  return name;
}
