import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { fromFileUrl } from "jsr:@std/path@^1.0.0";
import { accent, bold, dim, muted } from "./utils/term.ts";

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

const VERSION = "0.1.0";
const main = new Command()
  .name("decker")
  .version(VERSION)
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

function formatArg(a: { name: string; optional?: boolean; variadic?: boolean }): string {
  const inner = a.variadic ? `${a.name}...` : a.name;
  return a.optional ? `[${inner}]` : `<${inner}>`;
}

function printHelp() {
  console.log("");
  console.log(`  ${bold("decker")}  ${dim("— deck your own devnet")}`);
  console.log("");

  const lines: Array<{ head: string; desc: string }> = [];
  for (const name of ordered) {
    const sub = main.getCommand(name);
    if (!sub) continue;
    const args = sub.getArguments().map(formatArg).join(" ");
    const head = args ? `${name} ${args}` : name;
    lines.push({ head, desc: sub.getDescription() });
  }
  const w = Math.max(...lines.map((l) => l.head.length));
  for (const l of lines) {
    console.log(`  ${accent(l.head.padEnd(w))}  ${dim(l.desc)}`);
  }
  console.log("");
  const optW = "-V, --version".length;
  console.log(`  ${muted("-h, --help".padEnd(optW))}  ${dim("Show this help")}`);
  console.log(`  ${muted("-V, --version".padEnd(optW))}  ${dim(`Show the version (${VERSION})`)}`);
  console.log("");
}

const wantsHelp = Deno.args.length === 0 ||
  (Deno.args.length === 1 && (Deno.args[0] === "--help" || Deno.args[0] === "-h" || Deno.args[0] === "help"));

if (wantsHelp) {
  printHelp();
  Deno.exit(0);
}

await main.parse(Deno.args);
