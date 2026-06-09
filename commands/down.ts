import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RUNTIME_PODMAN = `${DECKER_ROOT}/runtime/podman.yaml`;
const RUNTIME_PC = `${DECKER_ROOT}/runtime/process-compose.yaml`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function down(): Promise<number> {
  if (!(await fileExists(RUNTIME_PODMAN))) return 0;

  let code = 0;
  if (await fileExists(RUNTIME_PC)) {
    const pc = await new Deno.Command("process-compose", {
      args: ["down"],
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (pc.code !== 0) code = pc.code;
  }
  const kube = await new Deno.Command("podman", {
    args: ["kube", "down", RUNTIME_PODMAN],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (kube.code !== 0) code = kube.code;
  return code;
}

export const command = new Command()
  .description("Tear down the last `decker up` via podman kube down")
  .action(async () => {
    Deno.exit(await down());
  });
