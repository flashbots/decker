import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { join } from "jsr:@std/path@^1.0.0";
import { bold, cyan, dim, green, ms, red } from "../utils/term.ts";

const SOURCE = "https://github.com/flashbots/decker.git";
const REF = "main";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

export const command = new Command()
  .description("Clone the decker repo (latest main) into the current directory")
  .action(async () => {
    const cwd = Deno.cwd();
    console.log(`${dim("→")} cloning ${bold(SOURCE)}${dim(`@${REF}`)} → ${cyan(cwd)}`);
    const t0 = performance.now();
    const tmpDir = await Deno.makeTempDir({ dir: cwd, prefix: ".decker-init-" });
    try {
      const cloned = await new Deno.Command("git", {
        args: ["clone", "--quiet", "--depth", "1", "--branch", REF, SOURCE, tmpDir],
        stdout: "inherit",
        stderr: "inherit",
      }).output();
      if (cloned.code !== 0) Deno.exit(cloned.code);

      const conflicts: string[] = [];
      for await (const entry of Deno.readDir(tmpDir)) {
        if (await exists(join(cwd, entry.name))) conflicts.push(entry.name);
      }
      if (conflicts.length > 0) {
        console.error(red(`✗ already exists in ${cwd}: ${conflicts.join(", ")}`));
        await Deno.remove(tmpDir, { recursive: true });
        Deno.exit(1);
      }
      for await (const entry of Deno.readDir(tmpDir)) {
        await Deno.rename(join(tmpDir, entry.name), join(cwd, entry.name));
      }
    } finally {
      try {
        await Deno.remove(tmpDir, { recursive: true });
      } catch { /* ignore */ }
    }
    console.log(`${green("✓")} cloned ${dim(`(${ms(t0)})`)}`);
  });
