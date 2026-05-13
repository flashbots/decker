import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { artifactsHostPath, generateArtifacts, loadRecipe } from "../utils/build.ts";

export const command = new Command()
  .description("Generate artifacts for a recipe via builder-playground --dry-run")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const { recipe } = await loadRecipe(target);
    console.log(
      `builder-playground start ${recipe.artifacts} --dry-run --output ${artifactsHostPath(recipe)}`,
    );
    const r = await generateArtifacts(recipe);
    await Deno.stdout.write(r.stdout);
    Deno.exit(r.code);
  });
