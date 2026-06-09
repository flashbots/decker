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
  .description("Decker — deck your own devnet");

const COMMAND_ORDER = [
  "init",
  "spit",
  "recipes",
  "start",
  "up",
  "down",
  "attach",
  "test",
  "build",
  "artifacts",
];

const commandsDir = new URL("./commands/", import.meta.url);
const discovered: string[] = [];
for await (const entry of Deno.readDir(commandsDir)) {
  if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
  discovered.push(entry.name.slice(0, -3));
}
const ordered = [
  ...COMMAND_ORDER.filter((n) => discovered.includes(n)),
  ...discovered.filter((n) => !COMMAND_ORDER.includes(n)).sort(),
];
for (const name of ordered) {
  const mod = await import(new URL(`${name}.ts`, commandsDir).href);
  if (mod.command instanceof Command) {
    main.command(name, mod.command);
  }
}

await main.parse(Deno.args);
