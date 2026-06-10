import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { loadRecipe } from "../utils/build.ts";
import { lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import { accent, bold, dim, muted, rule, warn } from "../utils/term.ts";
import { down } from "./down.ts";
import { printSummary, resolveTarget, runManifest, type TargetOverride, type UpOutcome, upTarget } from "./up.ts";

async function advertise(target: string, out: UpOutcome) {
  const { recipe } = await loadRecipe(target);
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
  printSummary(out.renderers, out.paths);
  console.log("");
  console.log(`  ${muted("Ctrl+C to stop")}`);
}

export const command = new Command()
  .description("Start and attach to a recipe (take down with Ctrl+C)")
  .option("--pods <renderer:string>", "Override recipe target for pods")
  .option("--processes <renderer:string>", "Override recipe target for processes")
  .arguments("[target:string]")
  .action(async (opts, target?: string) => {
    const override: TargetOverride = { pods: opts.pods, processes: opts.processes };
    const t = await resolveTarget(target);
    if (t.kind === "manifest") {
      const noop = () => {};
      Deno.addSignalListener("SIGINT", noop);
      Deno.addSignalListener("SIGTERM", noop);
      Deno.exit(await runManifest("start", t.path));
    }

    const out = await upTarget(t.kind === "recipe" ? t.target : t.path, override);
    if (out.code !== 0) Deno.exit(out.code);
    if (t.kind === "recipe") await advertise(t.target, out);

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
