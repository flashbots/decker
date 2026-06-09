import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { dim, success, warn } from "../utils/term.ts";

const SRC = new URL("../decker.example.ts", import.meta.url).pathname;

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function confirm(prompt: string): Promise<boolean> {
  await Deno.stdout.write(new TextEncoder().encode(prompt));
  const buf = new Uint8Array(8);
  const n = await Deno.stdin.read(buf);
  const ans = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

export const command = new Command()
  .description("Write a new decker.ts config into the current directory")
  .action(async () => {
    const dst = `${Deno.cwd()}/decker.ts`;
    if (await exists(dst)) {
      if (!await confirm(`${warn("?")} ${dst} exists. Overwrite? [y/N] `)) {
        console.log(dim("aborted"));
        return;
      }
    }
    await Deno.copyFile(SRC, dst);
    console.log(`${success("✓")} wrote ${dst}`);
  });
