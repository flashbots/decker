import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { red } from "../utils/term.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RUNTIME_PC = `${DECKER_ROOT}/.runtime/process-compose.yaml`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function attach(): Promise<number> {
  if (!(await fileExists(RUNTIME_PC))) {
    console.error(red(`✗ no process-compose runtime at ${RUNTIME_PC}`));
    return 1;
  }
  const { code } = await new Deno.Command("process-compose", {
    args: ["attach"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return code;
}

export const command = new Command()
  .description("Attach to the running process-compose TUI")
  .action(async () => {
    Deno.exit(await attach());
  });
