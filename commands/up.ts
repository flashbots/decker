import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { generateArtifacts, loadRecipe, missingBinaries } from "../utils/build.ts";
import { emit } from "../utils/emit.ts";
import { ensureImages } from "../utils/image-build.ts";
import { DEFAULT_MANIFEST, ensureClone, loadManifest } from "../utils/manifest.ts";
import { DOZZLE_PORT } from "../utils/render-podman.ts";
import { dim, done, fail, note, red, rule, step, summary } from "../utils/term.ts";
import type { ImageBuildSpec, Recipe } from "../utils/types.ts";

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

export async function printSummary() {
  const entries: Array<[string, string]> = [
    ["Pod logs (Dozzle)", `http://localhost:${DOZZLE_PORT}`],
  ];
  if (await fileExists(`${DECKER_ROOT}/runtime/process-compose.yaml`)) {
    entries.push(["Process logs (process-compose)", "decker attach"]);
  }
  summary(entries);
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
  let loadedRecipe: Recipe | null = null;
  let imageBuilds: Map<string, ImageBuildSpec> = new Map();

  if (target.endsWith(".yaml")) {
    yamlPath = await Deno.realPath(target);
  } else {
    const { name, recipe } = await loadRecipe(target);
    loadedRecipe = recipe;

    rule(name);

    const sArt = step("generating artifacts");
    try {
      await generateArtifacts(recipe);
    } catch (e) {
      fail(sArt, (e as Error).message);
      return 1;
    }
    done(sArt, `${recipe.artifacts.generator}/${recipe.artifacts.fork}`);

    const sEmit = step("rendering manifests");
    const emitted = await emit(name, recipe);
    imageBuilds = emitted.imageBuilds;
    done(sEmit);

    const missing = missingBinaries(emitted.binaries);
    if (missing.length > 0) {
      console.error("");
      console.error(red("✗ host binaries not found:"));
      for (const b of missing) console.error(`    ${b}`);
      console.error("");
      console.error(`  ${dim("place them in ./bin/, set 'binary' in the recipe, or install on PATH")}`);
      return 1;
    }

    yamlPath = `${DECKER_ROOT}/runtime/podman.yaml`;
    podCount = recipe.pods.length + 1;
  }

  if (imageBuilds.size > 0) {
    rule("images");
    const t = performance.now();
    try {
      const built = await ensureImages(imageBuilds);
      const skipped = imageBuilds.size - built.length;
      const extra = built.length > 0
        ? `built ${built.length}${skipped > 0 ? `, cached ${skipped}` : ""}`
        : `cached ${skipped}`;
      note("✓", `images ready ${dim(`(${extra})`)}`, t);
    } catch (e) {
      console.error(red(`✗ image build failed: ${(e as Error).message}`));
      return 1;
    }
  }

  const pcPath = yamlPath.replace(/\/[^/]+\.yaml$/, "/process-compose.yaml");
  const hasPC = await fileExists(pcPath);

  rule("pods");
  const sPods = step(podCount === null ? "starting pods" : `starting ${podCount} pods`);
  const play = await new Deno.Command("podman", {
    args: ["kube", "play", yamlPath],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (play.code !== 0) {
    fail(sPods, "podman kube play failed");
    await Deno.stdout.write(play.stdout);
    return play.code;
  }
  done(sPods);

  if ((loadedRecipe?.scripts ?? []).length > 0) {
    rule("scripts");
    for (const script of loadedRecipe?.scripts ?? []) {
      const label = script.name || "script";
      const t = performance.now();
      try {
        await script(loadedRecipe!);
        note("✓", label, t);
      } catch (e) {
        console.error(red(`✗ ${label} failed: ${(e as Error).message}`));
        return 1;
      }
    }
  }

  if (hasPC) {
    rule("host processes");
    const t = performance.now();
    const pc = await new Deno.Command("process-compose", {
      args: ["up", "-f", pcPath, "--detached"],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (pc.code !== 0) {
      console.error(red("✗ process-compose up failed"));
      return pc.code;
    }
    note("✓", "host processes started", t);
  }
  return 0;
}

export async function up(arg?: string): Promise<number> {
  const t = await resolveTarget(arg);
  if (t.kind === "manifest") return await runManifest("up", t.path);
  return await upTarget(t.kind === "recipe" ? t.target : t.path);
}

export const command = new Command()
  .description("Start a recipe and detach")
  .arguments("[target:string]")
  .action(async (_, target?: string) => {
    const t = await resolveTarget(target);
    if (t.kind === "manifest") {
      Deno.exit(await runManifest("up", t.path));
    }
    const code = await upTarget(t.kind === "recipe" ? t.target : t.path);
    if (code === 0) await printSummary();
    Deno.exit(code);
  });
