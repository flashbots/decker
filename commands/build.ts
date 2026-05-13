import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { buildOne } from "../utils/build.ts";
import { bold, dim, green } from "../utils/term.ts";

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
      const name = await buildOne(r);
      console.log(`${green("✓")} rendered ${bold(name)} ${dim(`→ manifests/${name}/`)}`);
    }
  });
