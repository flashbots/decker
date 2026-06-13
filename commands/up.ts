import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { generateArtifacts, loadRecipe, missingBinaries } from "../utils/build.ts";
import { emit } from "../utils/emit.ts";
import { ensureImages } from "../utils/image-build.ts";
import { DEFAULT_MANIFEST, ensureClone, loadManifest } from "../utils/manifest.ts";
import { dim, done, fail, note, red, rule, step, summary } from "../utils/term.ts";
import type { ImageBuildSpec, ImageEngine, Recipe, Renderer, RendererPaths } from "../utils/types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RUNTIME_DIR = `${DECKER_ROOT}/runtime`;

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

export function printSummary(renderers: Renderer[], paths: RendererPaths) {
  const entries: Array<[string, string]> = [];
  for (const r of renderers) {
    if (r.summary) entries.push(...r.summary(paths));
  }
  summary(entries);
}

export type TargetOverride = { pods?: string; processes?: string };

function applyTargetOverride(recipe: Recipe, override?: TargetOverride): Recipe {
  if (!override || (!override.pods && !override.processes)) return recipe;
  return {
    ...recipe,
    target: {
      ...recipe.target,
      ...(override.pods ? { pods: override.pods } : {}),
      ...(override.processes ? { processes: override.processes } : {}),
    },
  };
}

export async function runManifest(sub: "up" | "start", manifestPath: string): Promise<number> {
  const m = await loadManifest(manifestPath);
  const into = await ensureClone(m.project);
  const extra: string[] = [];
  if (m.project.target?.pods) extra.push("--pods", m.project.target.pods);
  if (m.project.target?.processes) extra.push("--processes", m.project.target.processes);
  const proc = new Deno.Command("deno", {
    args: ["run", "-A", `${into}/cli.ts`, sub, ...extra, m.project.recipe],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await proc.status;
  return code;
}

export type UpOutcome = {
  code: number;
  renderers: Renderer[];
  paths: RendererPaths;
};

export async function upTarget(
  target: string,
  override?: TargetOverride,
  opts: { attached?: boolean } = {},
): Promise<UpOutcome> {
  let loadedRecipe: Recipe | null = null;
  let renderers: Renderer[] = [];
  let paths: RendererPaths = { runtimeDir: RUNTIME_DIR, manifestDir: "" };
  let imageBuilds: Map<string, ImageBuildSpec> = new Map();

  if (target.endsWith(".yaml")) {
    paths = { runtimeDir: RUNTIME_DIR, manifestDir: "" };
  } else {
    const { name, recipe: loaded } = await loadRecipe(target);
    const recipe = applyTargetOverride(loaded, override);
    loadedRecipe = recipe;

    rule(name);

    if (recipe.artifacts) {
      const sArt = step("generating artifacts");
      try {
        await generateArtifacts(recipe);
      } catch (e) {
        fail(sArt, (e as Error).message);
        return { code: 1, renderers, paths };
      }
      done(sArt, `${recipe.artifacts.generator}/${recipe.artifacts.fork}`);
    }

    const sEmit = step("rendering manifests");
    const emitted = await emit(name, recipe, { attached: opts.attached });
    imageBuilds = emitted.imageBuilds;
    renderers = emitted.selected;
    paths = emitted.paths;
    done(sEmit, renderers.map((r) => r.name).join(" + "));

    const missing = missingBinaries(emitted.binaries);
    if (missing.length > 0) {
      console.error("");
      console.error(red("✗ host binaries not found:"));
      for (const b of missing) console.error(`    ${b}`);
      console.error("");
      console.error(`  ${dim("place them in ./bin/, set 'binary' in the recipe, or install on PATH")}`);
      return { code: 1, renderers, paths };
    }
  }

  if (imageBuilds.size > 0) {
    rule("images");
    const t = performance.now();
    const engine: ImageEngine = renderers.find((r) => r.slot === "pods")?.imageEngine ?? "podman";
    try {
      const built = await ensureImages(imageBuilds, engine);
      const skipped = imageBuilds.size - built.length;
      const extra = built.length > 0
        ? `built ${built.length}${skipped > 0 ? `, cached ${skipped}` : ""}`
        : `cached ${skipped}`;
      note("✓", `images ready ${dim(`(${extra})`)}`, t);
    } catch (e) {
      console.error(red(`✗ image build failed: ${(e as Error).message}`));
      return { code: 1, renderers, paths };
    }
  }

  const runnable = renderers.filter((r) => r.start);
  const pods = runnable.filter((r) => r.slot === "pods");
  const procs = runnable.filter((r) => r.slot === "processes");

  for (const r of pods) {
    rule(r.slot);
    const sp = step(`starting ${r.name}`);
    const code = await r.start!(paths);
    if (code !== 0) {
      fail(sp, `${r.name} start failed`);
      return { code, renderers, paths };
    }
    done(sp);
  }

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
        return { code: 1, renderers, paths };
      }
    }
  }

  for (const r of procs) {
    rule(r.slot);
    const t = performance.now();
    const code = await r.start!(paths);
    if (code !== 0) {
      console.error(red(`✗ ${r.name} start failed`));
      return { code, renderers, paths };
    }
    note("✓", `${r.name} started`, t);
  }

  return { code: 0, renderers, paths };
}

export async function up(
  arg?: string,
  override?: TargetOverride,
  opts: { attached?: boolean } = {},
): Promise<number> {
  const t = await resolveTarget(arg);
  if (t.kind === "manifest") return await runManifest("up", t.path);
  return (await upTarget(t.kind === "recipe" ? t.target : t.path, override, opts)).code;
}

export const command = new Command()
  .description("Start a recipe and detach")
  .option("--pods <renderer:string>", "Override recipe target for pods")
  .option("--processes <renderer:string>", "Override recipe target for processes")
  .arguments("[target:string]")
  .action(async (opts, target?: string) => {
    const override: TargetOverride = { pods: opts.pods, processes: opts.processes };
    const t = await resolveTarget(target);
    if (t.kind === "manifest") {
      Deno.exit(await runManifest("up", t.path));
    }
    const out = await upTarget(t.kind === "recipe" ? t.target : t.path, override);
    if (out.code === 0) printSummary(out.renderers, out.paths);
    Deno.exit(out.code);
  });
