import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { generateArtifacts, loadRecipe } from "../utils/build.ts";
import { emit } from "../utils/emit.ts";
import { DOZZLE_PORT } from "../utils/render-local.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const LATEST = `${REPO_ROOT}manifests/latest.yaml`;

export async function up(target: string): Promise<number> {
  let yamlPath: string;
  if (target.endsWith(".yaml")) {
    yamlPath = await Deno.realPath(target);
  } else {
    const { name, recipe } = await loadRecipe(target);
    const artifactsCode = await generateArtifacts(recipe);
    if (artifactsCode !== 0) return artifactsCode;
    await emit(name, recipe);
    yamlPath = `${REPO_ROOT}manifests/${name}/local.yaml`;
  }
  await Deno.copyFile(yamlPath, LATEST);
  console.log(`copied ${yamlPath} → ${LATEST}`);
  const { code } = await new Deno.Command("podman", {
    args: ["kube", "play", LATEST],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (code === 0) console.log(`Dozzle: http://localhost:${DOZZLE_PORT}`);
  return code;
}

export const command = new Command()
  .description("Build (if needed) and run a recipe via podman kube play")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    Deno.exit(await up(target));
  });
