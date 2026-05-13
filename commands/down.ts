import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const LATEST = `${REPO_ROOT}manifests/latest.yaml`;

export async function down(): Promise<number> {
  const { code } = await new Deno.Command("podman", {
    args: ["kube", "down", LATEST],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return code;
}

export const command = new Command()
  .description("Tear down the last `decker up` via podman kube down")
  .action(async () => {
    Deno.exit(await down());
  });
