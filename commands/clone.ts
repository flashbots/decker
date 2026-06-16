import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { join } from "jsr:@std/path@^1.0.0";
import { done, fail, step } from "../utils/term.ts";

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
  .description("Kickstart with the decker repo (latest main) in the current directory")
  .action(async () => {
    const cwd = Deno.cwd();
    const sp = step(`cloning ${SOURCE}@${REF}`);
    const tmpDir = await Deno.makeTempDir({ dir: cwd, prefix: ".decker-clone-" });
    try {
      const cloned = await new Deno.Command("git", {
        args: ["clone", "--quiet", "--depth", "1", "--branch", REF, SOURCE, tmpDir],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (cloned.code !== 0) {
        fail(sp, "git clone failed");
        await Deno.stderr.write(cloned.stderr);
        await Deno.remove(tmpDir, { recursive: true });
        Deno.exit(cloned.code);
      }

      const conflicts: string[] = [];
      for await (const entry of Deno.readDir(tmpDir)) {
        if (await exists(join(cwd, entry.name))) conflicts.push(entry.name);
      }
      if (conflicts.length > 0) {
        fail(sp, `already exists in ${cwd}: ${conflicts.join(", ")}`);
        await Deno.remove(tmpDir, { recursive: true });
        Deno.exit(1);
      }
      for await (const entry of Deno.readDir(tmpDir)) {
        await Deno.rename(join(tmpDir, entry.name), join(cwd, entry.name));
      }
      await Deno.remove(tmpDir, { recursive: true });
    } catch (e) {
      fail(sp, (e as Error).message);
      try {
        await Deno.remove(tmpDir, { recursive: true });
      } catch { /* ignore */ }
      Deno.exit(1);
    }
    done(sp, cwd);
  });
