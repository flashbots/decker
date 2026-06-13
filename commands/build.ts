import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { buildOne, generateArtifacts, loadRecipe, missingBinaries } from "../utils/build.ts";
import { done, fail, step, warn } from "../utils/term.ts";

const RECIPES_DIR = new URL("../recipes/", import.meta.url);

async function listRecipes(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(RECIPES_DIR)) {
    if (entry.isFile && entry.name.endsWith(".ts")) names.push(entry.name.slice(0, -3));
  }
  return names.sort();
}

export const command = new Command()
  .description("Build recipes into manifests/")
  .arguments("[recipes...:string]")
  .action(async (_, ...recipes: string[]) => {
    const targets = recipes.length === 0 ? await listRecipes() : recipes;
    for (const r of targets) {
      const { recipe } = await loadRecipe(r);
      const sArt = step(`generating artifacts for ${r}`);
      try {
        await generateArtifacts(recipe);
      } catch (e) {
        fail(sArt, (e as Error).message);
        Deno.exit(1);
      }
      done(sArt, recipe.artifacts ? `${recipe.artifacts.generator}/${recipe.artifacts.fork}` : "no artifacts");
      const sp = step(`rendering ${r}`);
      const { name, binaries } = await buildOne(r);
      done(sp, `manifests/${name}/`);
      const missing = missingBinaries(binaries);
      if (missing.length > 0) {
        console.log(`  ${warn("!")} host binaries not found: ${missing.join(", ")}`);
      }
    }
  });
