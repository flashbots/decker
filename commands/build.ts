import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { artifactsLabel, buildOne, generateArtifacts, loadRecipe, missingBinaries, parseOpts } from "../utils/build.ts";
import { cleanRuntime } from "../utils/emit.ts";
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
  .option("--opt <keyvalue:string>", "Pass an option to a factory recipe: key=value (repeatable)", { collect: true })
  .arguments("[recipes...:string]")
  .action(async (opts, ...recipes: string[]) => {
    const options = parseOpts(opts.opt);
    const targets = recipes.length === 0 ? await listRecipes() : recipes;
    for (const r of targets) {
      const { recipe } = await loadRecipe(r, options);
      await cleanRuntime();
      const sArt = step(`generating artifacts for ${r}`);
      try {
        await generateArtifacts(recipe);
      } catch (e) {
        fail(sArt, (e as Error).message);
        Deno.exit(1);
      }
      done(sArt, artifactsLabel(recipe));
      const sp = step(`rendering ${r}`);
      const { name, binaries, binaryBuilds } = await buildOne(r, options);
      done(sp, `manifests/${name}/`);
      // Binaries built from source land at `up` time; don't flag them missing here.
      const managed = new Set(binaryBuilds);
      const missing = missingBinaries(binaries.filter((b) => !managed.has(b)));
      if (missing.length > 0) {
        console.log(`  ${warn("!")} host binaries not found: ${missing.join(", ")}`);
      }
      if (binaryBuilds.length > 0) {
        console.log(`  ${warn("!")} binaries built from source on 'up': ${binaryBuilds.length}`);
      }
    }
  });
