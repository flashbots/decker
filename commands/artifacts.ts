import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { artifactsHostPath, generateArtifacts, loadRecipe } from "../utils/build.ts";
import { done, fail, step } from "../utils/term.ts";

export const command = new Command()
  .description("Generate a recipe's artifacts")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const { name, recipe } = await loadRecipe(target);
    const out = artifactsHostPath(recipe);
    const sp = step(`generating ${name} artifacts`);
    try {
      await generateArtifacts(recipe);
    } catch (e) {
      fail(sp, (e as Error).message);
      Deno.exit(1);
    }
    done(sp, `${recipe.artifacts.generator}/${recipe.artifacts.fork} → ${out}`);
  });
