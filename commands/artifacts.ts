import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { artifactsHostPath, artifactsLabel, generateArtifacts, loadRecipe, parseOpts } from "../utils/build.ts";
import { done, fail, step } from "../utils/term.ts";

export const command = new Command()
  .description("Generate a recipe's artifacts")
  .option("--opt <keyvalue:string>", "Pass an option to a factory recipe: key=value (repeatable)", { collect: true })
  .arguments("<target:string>")
  .action(async (opts, target: string) => {
    const { name, recipe } = await loadRecipe(target, parseOpts(opts.opt));
    const out = artifactsHostPath(recipe);
    const sp = step(`generating ${name} artifacts`);
    try {
      await generateArtifacts(recipe);
    } catch (e) {
      fail(sp, (e as Error).message);
      Deno.exit(1);
    }
    done(sp, recipe.artifacts ? `${artifactsLabel(recipe)} → ${out}` : "no artifacts");
  });
