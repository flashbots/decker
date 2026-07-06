import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { loadRecipe } from "../utils/build.ts";
import { lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import { accent, bold, dim, muted, rule, warn } from "../utils/term.ts";
import { down } from "./down.ts";
import { printSummary, resolveInput, type TargetOverride, type UpOutcome, upProject, upRecipeFile } from "./up.ts";

async function advertise(ref: string, out: UpOutcome) {
  const { recipe } = await loadRecipe(ref);
  rule("services");
  const advertised = [
    ...recipe.pods.flatMap((p) => p.containers),
    ...(recipe.processes ?? []),
  ];
  for (const c of advertised) {
    const proto = lookup(c.prototype);
    const entries = Object.entries(proto.ports);
    console.log(`  ${bold(accent(c.name))}${entries.length === 0 ? dim("  (no ports)") : ""}`);
    for (const [name, spec] of entries) {
      console.log(`    ${name.padEnd(10)} ${warn(String(portNum(spec)))}`);
    }
  }
  printSummary(out.renderers, out.paths, out.recipe);
  console.log("");
  console.log(`  ${muted("Ctrl+C to stop")}`);
}

export const command = new Command()
  .description("Start and attach to a recipe (take down with Ctrl+C)")
  .option("--pods <renderer:string>", "Override recipe target for pods")
  .option("--processes <renderer:string>", "Override recipe target for processes")
  .option("--script <path:string>", "Append a script module to the recipe (repeatable)", { collect: true })
  .arguments("[input:string]")
  .action(async (opts, arg?: string) => {
    const override: TargetOverride = { pods: opts.pods, processes: opts.processes };
    const input = await resolveInput(arg);
    if (input.kind === "project") {
      const noop = () => {};
      Deno.addSignalListener("SIGINT", noop);
      Deno.addSignalListener("SIGTERM", noop);
      Deno.exit(await upProject("start", input.path, opts.script));
    }

    const out = await upRecipeFile(input.ref, override, { scripts: opts.script });
    if (out.code !== 0) Deno.exit(out.code);
    await advertise(input.ref, out);

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
