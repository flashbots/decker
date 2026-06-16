import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { allRenderers } from "../utils/renderers.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RUNTIME_DIR = `${DECKER_ROOT}/runtime`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function down(runtimeDir: string = RUNTIME_DIR): Promise<number> {
  if (!(await fileExists(runtimeDir))) return 0;
  let code = 0;
  // processes first so they detach from any podman backends, then pods
  const ordered = [
    ...allRenderers().filter((r) => r.slot === "processes" && r.stop),
    ...allRenderers().filter((r) => r.slot === "pods" && r.stop),
  ];
  for (const r of ordered) {
    const c = await r.stop!(runtimeDir);
    if (c !== 0) code = c;
  }
  return code;
}

export const command = new Command()
  .description("Take down the last `decker up`")
  .action(async () => {
    Deno.exit(await down());
  });
