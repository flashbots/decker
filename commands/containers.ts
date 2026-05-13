import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";

const CONTAINERS_DIR = new URL("../containers/", import.meta.url);

export const command = new Command()
  .description("List built-in containers")
  .action(async () => {
    const names: string[] = [];
    for await (const entry of Deno.readDir(CONTAINERS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
      names.push(entry.name.slice(0, -3));
    }
    names.sort();
    for (const n of names) console.log(n);
  });
