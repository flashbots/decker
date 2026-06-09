import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { artifactsHostPath, generateArtifacts, loadRecipe } from "../utils/build.ts";
import { bold, dim, green, ms, red } from "../utils/term.ts";

export const command = new Command()
  .description("Generate a recipe's artifacts into its artifactsHostPath without starting pods")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const { name, recipe } = await loadRecipe(target);
    const out = artifactsHostPath(recipe);
    const t0 = performance.now();
    try {
      await generateArtifacts(recipe);
    } catch (e) {
      console.error(red(`✗ artifacts failed: ${(e as Error).message}`));
      Deno.exit(1);
    }
    console.log(`${green("✓")} ${bold(name)} artifacts generated ${dim(`(${recipe.artifacts.generator}/${recipe.artifacts.fork} → ${out}, ${ms(t0)})`)}`);
  });
