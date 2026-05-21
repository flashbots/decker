import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { bold, cyan, dim, green, ms, red } from "../utils/term.ts";

const SOURCE = "https://github.com/flashbots/decker.git";
const REF = "main";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export const command = new Command()
  .description("Clone the decker repo (latest main)")
  .arguments("[into:string]")
  .action(async (_, into?: string) => {
    const dst = into ?? "decker";
    if (await exists(dst)) {
      console.error(red(`${dst} already exists`));
      Deno.exit(1);
    }
    console.log(`${dim("→")} cloning ${bold(SOURCE)}${dim(`@${REF}`)} → ${cyan(dst)}`);
    const t0 = performance.now();
    const { code } = await new Deno.Command("git", {
      args: ["clone", "--depth", "1", "--branch", REF, SOURCE, dst],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (code !== 0) Deno.exit(code);
    console.log(`${green("✓")} cloned ${dim(`(${ms(t0)})`)}`);
  });
