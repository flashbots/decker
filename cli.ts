import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { fromFileUrl } from "jsr:@std/path@^1.0.0";

const me = await Deno.realPath(fromFileUrl(import.meta.url));
let local: string | null = null;
try {
  local = await Deno.realPath(`${Deno.cwd()}/cli.ts`);
} catch { /* none */ }

if (local && local !== me) {
  const proc = new Deno.Command("deno", {
    args: ["run", "-A", local, ...Deno.args],
  }).spawn();
  const { code } = await proc.status;
  Deno.exit(code);
}

const main = new Command()
  .name("decker")
  .version("0.1.0")
  .description("Decker — devnet recipe renderer");

const commandsDir = new URL("./commands/", import.meta.url);
for await (const entry of Deno.readDir(commandsDir)) {
  if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
  const name = entry.name.slice(0, -3);
  const mod = await import(new URL(entry.name, commandsDir).href);
  if (mod.command instanceof Command) {
    main.command(name, mod.command);
  }
}

await main.parse(Deno.args);
