import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { generateArtifacts, loadRecipe, missingBinaries } from "../utils/build.ts";
import { emit } from "../utils/emit.ts";
import { DEFAULT_MANIFEST, ensureClone, loadManifest } from "../utils/manifest.ts";
import { DOZZLE_PORT } from "../utils/render-podman.ts";
import { bold, cyan, dim, green, ms, red, underline } from "../utils/term.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export type Target =
  | { kind: "recipe"; target: string }
  | { kind: "manifest"; path: string }
  | { kind: "yaml"; path: string };

export async function resolveTarget(arg?: string): Promise<Target> {
  if (!arg) return { kind: "manifest", path: DEFAULT_MANIFEST };
  if (arg.endsWith(".yaml")) return { kind: "yaml", path: arg };
  if (arg.endsWith(".ts") || arg.includes("/")) {
    const abs = isAbsolute(arg) ? arg : join(Deno.cwd(), arg);
    const real = await Deno.realPath(abs);
    const mod = await import(toFileUrl(real).href);
    if (mod.project) return { kind: "manifest", path: real };
    if (mod.recipe) return { kind: "recipe", target: real };
    throw new Error(`${arg} must export 'recipe' or 'project'`);
  }
  return { kind: "recipe", target: arg };
}

export function printDozzle() {
  console.log(`  ${bold("Pod logs (Dozzle):")} ${cyan(underline(`http://localhost:${DOZZLE_PORT}`))}`);
}

export async function printAttachIfProcesses() {
  if (await fileExists(`${DECKER_ROOT}/.runtime/process-compose.yaml`)) {
    console.log(`  ${bold("Process logs (process-compose):")} ${cyan("decker attach")}`);
  }
}

export async function runManifest(sub: "up" | "start", manifestPath: string): Promise<number> {
  const m = await loadManifest(manifestPath);
  const into = await ensureClone(m.project);
  const proc = new Deno.Command("deno", {
    args: ["run", "-A", `${into}/cli.ts`, sub, m.project.recipe],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await proc.status;
  return code;
}

export async function upTarget(target: string): Promise<number> {
  let yamlPath: string;
  let podCount: number | null = null;

  if (target.endsWith(".yaml")) {
    yamlPath = await Deno.realPath(target);
  } else {
    const { name, recipe } = await loadRecipe(target);

    const t1 = performance.now();
    const { binaries } = await emit(name, recipe);
    console.log(`${green("✓")} rendered ${bold(name)} ${dim(`(${ms(t1)})`)}`);

    const missing = missingBinaries(binaries);
    if (missing.length > 0) {
      console.error("");
      console.error(red("✗ host binaries not found:"));
      for (const b of missing) console.error(`    ${b}`);
      console.error("");
      console.error(`  ${dim("place them in ./bin/, set 'binary' in the recipe, or install on PATH")}`);
      return 1;
    }

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

    yamlPath = `${DECKER_ROOT}/.runtime/podman.yaml`;
    podCount = recipe.pods.length + 1;
  }

  const pcPath = yamlPath.replace(/\/[^/]+\.yaml$/, "/process-compose.yaml");
  const hasPC = await fileExists(pcPath);

  const t2 = performance.now();
  const play = await new Deno.Command("podman", {
    args: ["kube", "play", yamlPath],
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

  if (hasPC) {
    const t3 = performance.now();
    const pc = await new Deno.Command("process-compose", {
      args: ["up", "-f", pcPath, "--detached"],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (pc.code !== 0) {
      console.error(red("✗ process-compose up failed"));
      return pc.code;
    }
    console.log(`${green("✓")} host processes started ${dim(`(${ms(t3)})`)}`);
  }
  return 0;
}

export async function up(arg?: string): Promise<number> {
  const t = await resolveTarget(arg);
  if (t.kind === "manifest") return await runManifest("up", t.path);
  return await upTarget(t.kind === "recipe" ? t.target : t.path);
}

export const command = new Command()
  .description("Build (if needed) and run a recipe via podman kube play")
  .arguments("[target:string]")
  .action(async (_, target?: string) => {
    const t = await resolveTarget(target);
    if (t.kind === "manifest") {
      Deno.exit(await runManifest("up", t.path));
    }
    const code = await upTarget(t.kind === "recipe" ? t.target : t.path);
    if (code === 0) {
      console.log("");
      printDozzle();
      await printAttachIfProcesses();
    }
    Deno.exit(code);
  });
