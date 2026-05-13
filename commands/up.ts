import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { generateArtifacts, loadRecipe } from "../utils/build.ts";
import { emit } from "../utils/emit.ts";
import { DOZZLE_PORT } from "../utils/render-local.ts";
import { bold, cyan, dim, green, ms, red, underline } from "../utils/term.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const LATEST = `${REPO_ROOT}manifests/latest.yaml`;

export function printDozzle() {
  console.log(`  ${bold("Dozzle")}  ${cyan(underline(`http://localhost:${DOZZLE_PORT}`))}`);
}

export async function up(target: string): Promise<number> {
  let yamlPath: string;
  let podCount: number | null = null;

  if (target.endsWith(".yaml")) {
    yamlPath = await Deno.realPath(target);
  } else {
    const { name, recipe } = await loadRecipe(target);

    const t0 = performance.now();
    const ar = await generateArtifacts(recipe);
    if (ar.code !== 0) {
      await Deno.stdout.write(ar.stdout);
      console.error(red("✗ artifacts failed"));
      return ar.code;
    }
    console.log(
      `${green("✓")} artifacts generated ${dim(`(${recipe.artifacts}, ${ms(t0)})`)}`,
    );

    const t1 = performance.now();
    await emit(name, recipe);
    console.log(`${green("✓")} rendered ${bold(name)} ${dim(`(${ms(t1)})`)}`);

    yamlPath = `${REPO_ROOT}manifests/${name}/local.yaml`;
    podCount = recipe.pods.length + 1;
  }

  await Deno.copyFile(yamlPath, LATEST);

  const t2 = performance.now();
  const play = await new Deno.Command("podman", {
    args: ["kube", "play", LATEST],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (play.code !== 0) {
    await Deno.stdout.write(play.stdout);
    console.error(red("✗ podman kube play failed"));
    return play.code;
  }
  const label = podCount === null ? "started" : `started ${podCount} pods`;
  console.log(`${green("✓")} ${label} ${dim(`(${ms(t2)})`)}`);
  return 0;
}

export const command = new Command()
  .description("Build (if needed) and run a recipe via podman kube play")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const code = await up(target);
    if (code === 0) {
      console.log("");
      printDozzle();
    }
    Deno.exit(code);
  });
