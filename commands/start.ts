import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { loadRecipe } from "../utils/build.ts";
import { lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import { bold, cyan, dim, yellow } from "../utils/term.ts";
import { down } from "./down.ts";
import { printAttachIfProcesses, printDozzle, resolveTarget, runManifest, upTarget } from "./up.ts";

async function advertise(target: string) {
  const { recipe } = await loadRecipe(target);
  console.log("");
  const advertised = [
    ...recipe.pods.flatMap((p) => p.containers),
    ...(recipe.processes ?? []),
  ];
  for (const c of advertised) {
    const proto = lookup(c.prototype);
    const entries = Object.entries(proto.ports);
    console.log(`  ${bold(cyan(c.name))}${entries.length === 0 ? dim("  (no ports)") : ""}`);
    for (const [name, spec] of entries) {
      console.log(`    ${name.padEnd(10)} ${yellow(String(portNum(spec)))}`);
    }
    console.log("");
  }
  printDozzle();
  await printAttachIfProcesses();
  console.log("");
  console.log(`  ${dim("─ Ctrl+C to stop ─")}`);
}

export const command = new Command()
  .description("Up a recipe, advertise ports, and down on Ctrl+C")
  .arguments("[target:string]")
  .action(async (_, target?: string) => {
    const t = await resolveTarget(target);
    if (t.kind === "manifest") {
      const noop = () => {};
      Deno.addSignalListener("SIGINT", noop);
      Deno.addSignalListener("SIGTERM", noop);
      Deno.exit(await runManifest("start", t.path));
    }

    const code = await upTarget(t.kind === "recipe" ? t.target : t.path);
    if (code !== 0) Deno.exit(code);
    if (t.kind === "recipe") await advertise(t.target);

    let downing = false;
    const stop = async () => {
      if (downing) return;
      downing = true;
      console.log(`\n${dim("stopping…")}`);
      const c = await down();
      Deno.exit(c);
    };
    Deno.addSignalListener("SIGINT", stop);
    Deno.addSignalListener("SIGTERM", stop);

    await new Promise(() => {});
  });
