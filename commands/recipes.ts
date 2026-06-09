import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { accent } from "../utils/term.ts";

const RECIPES_DIR = new URL("../recipes/", import.meta.url);

export const command = new Command()
  .description("List recipes")
  .action(async () => {
    const names: string[] = [];
    for await (const entry of Deno.readDir(RECIPES_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
      names.push(entry.name.slice(0, -3));
    }
    names.sort();
    for (const n of names) console.log(`  ${accent(n)}`);
  });
