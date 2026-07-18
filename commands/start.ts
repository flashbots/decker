import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { parseOpts } from "../utils/build.ts";
import { dim, muted } from "../utils/term.ts";
import { down } from "./down.ts";
import { resolveInput, type TargetOverride, upProject, upRecipeFile } from "./up.ts";

export const command = new Command()
  .description("Start and attach to a recipe (take down with Ctrl+C)")
  .option("--pods <renderer:string>", "Override recipe target for pods")
  .option("--processes <renderer:string>", "Override recipe target for processes")
  .option("--script <path:string>", "Append a script module to the recipe (repeatable)", { collect: true })
  .option("--opt <keyvalue:string>", "Pass an option to a factory recipe: key=value (repeatable)", { collect: true })
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

    const out = await upRecipeFile(input.ref, override, {
      scripts: opts.script,
      options: parseOpts(opts.opt),
      summarize: true,
    });
    if (out.code !== 0) Deno.exit(out.code);
    console.log("");
    console.log(`  ${muted("Ctrl+C to stop")}`);

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
