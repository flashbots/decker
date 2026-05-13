import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { buildAll, buildOne } from "../utils/build.ts";

export const command = new Command()
  .description("Build recipes into manifests/")
  .arguments("[recipes...:string]")
  .action(async (_, ...recipes: string[]) => {
    if (recipes.length === 0) {
      await buildAll();
      return;
    }
    for (const r of recipes) await buildOne(r);
  });
