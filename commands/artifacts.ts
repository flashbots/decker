import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { generateArtifacts, loadRecipe } from "../utils/build.ts";

export const command = new Command()
  .description("Generate artifacts for a recipe via builder-playground --dry-run")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const { recipe } = await loadRecipe(target);
    Deno.exit(await generateArtifacts(recipe));
  });
