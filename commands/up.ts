import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { dirname, isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { generateArtifacts, loadRecipe, loadScripts, missingBinaries } from "../utils/build.ts";
import { cleanRuntime, emit } from "../utils/emit.ts";
import { ensureBinaries } from "../utils/binary-build.ts";
import { ensureImages } from "../utils/image-build.ts";
import { DEFAULT_MANIFEST, ensureClone, loadManifest } from "../utils/manifest.ts";
import { lookup, makeCtx } from "../utils/resolve.ts";
import { accent, bold, dim, done, fail, note, red, rule, step, summary, warn } from "../utils/term.ts";
import { type ImageEngine, portNum, type Ports, type Recipe, type Renderer, type RendererPaths } from "../utils/types.ts";

import { DECKER_ROOT } from "../utils/root.ts";
const RUNTIME_DIR = `${DECKER_ROOT}/runtime`;

// What the user handed `decker up` to bring up: a recipe (by name or .ts path)
// or a project file (a decker.ts exporting `project`).
export type Input =
  | { kind: "recipe"; ref: string }
  | { kind: "project"; path: string };

export async function resolveInput(arg?: string): Promise<Input> {
  if (!arg) return { kind: "project", path: DEFAULT_MANIFEST };
  if (arg.endsWith(".ts") || arg.includes("/")) {
    const abs = isAbsolute(arg) ? arg : join(Deno.cwd(), arg);
    const real = await Deno.realPath(abs);
    const mod = await import(toFileUrl(real).href);
    if (mod.project) return { kind: "project", path: real };
    if (mod.recipe) return { kind: "recipe", ref: real };
    throw new Error(`${arg} must export 'recipe' or 'project'`);
  }
  return { kind: "recipe", ref: arg };
}

// Every service with its host ports (pods expose hostPort == containerPort, and
// processes listen on localhost directly). Prototype defaults merged with the
// recipe's per-container port overrides, same as the buildContainer convention.
export function printServices(recipe: Recipe) {
  rule("services");
  const advertised = [
    ...recipe.pods.flatMap((p) => p.containers),
    ...(recipe.processes ?? []),
  ];
  for (const c of advertised) {
    const proto = lookup(c.prototype);
    const ports: Ports = { ...proto.ports, ...((c.config?.ports as Ports | undefined) ?? {}) };
    const entries = Object.entries(ports);
    console.log(`  ${bold(accent(c.name))}${entries.length === 0 ? dim("  (no ports)") : ""}`);
    for (const [name, spec] of entries) {
      console.log(`    ${name.padEnd(10)} ${warn(String(portNum(spec)))}`);
    }
  }
}

export function printSummary(renderers: Renderer[], paths: RendererPaths, recipe?: Recipe) {
  const entries: Array<[string, string]> = [];
  for (const r of renderers) {
    if (r.summary) entries.push(...r.summary(paths));
  }
  // Web UIs declared by container prototypes (e.g. the explorers), listed after
  // the renderer's own lines (Dozzle). Host port == container port for pods, so
  // they're reachable on localhost.
  if (recipe) {
    const ctx = makeCtx(recipe, () => "localhost");
    for (const pod of recipe.pods) {
      for (const def of pod.containers) {
        const proto = lookup(def.prototype);
        if (!proto.webui) continue;
        entries.push([proto.webui.label, ctx.url(def.name, proto.webui.port ?? "http")]);
      }
    }
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

export async function upProject(sub: "up" | "start", projectPath: string, scripts: string[] = []): Promise<number> {
  const m = await loadManifest(projectPath);
  const into = await ensureClone(m.project);
  const extra: string[] = [];
  if (m.project.target?.pods) extra.push("--pods", m.project.target.pods);
  if (m.project.target?.processes) extra.push("--processes", m.project.target.processes);
  // Scripts are functions, so they can't ride the re-exec into the clone's CLI
  // as values — forward them as --script paths for the child to import. The
  // manifest's own entries resolve against the manifest's directory; extra ones
  // (from our --script flags) pass through as-is, since cwd is inherited.
  const manifestDir = dirname(m.path);
  for (const s of m.project.scripts ?? []) {
    extra.push("--script", isAbsolute(s) ? s : join(manifestDir, s));
  }
  for (const s of scripts) extra.push("--script", s);
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
  recipe: Recipe;
};

// up a recipe identified by name or .ts path (loads it, then upRecipe).
// opts.scripts are module paths appended after the recipe's own scripts —
// how a decker.ts manifest's `scripts` reach the recipe (see upProject).
export async function upRecipeFile(
  ref: string,
  override?: TargetOverride,
  opts: { attached?: boolean; runtimeDir?: string; scripts?: string[]; summarize?: boolean } = {},
): Promise<UpOutcome> {
  const { name, recipe } = await loadRecipe(ref);
  const extra = opts.scripts?.length ? await loadScripts(opts.scripts) : [];
  const merged = extra.length ? { ...recipe, scripts: [...(recipe.scripts ?? []), ...extra] } : recipe;
  return await upRecipe(name, merged, override, opts);
}

// up an in-memory recipe (no file). Scripts use this to run a parameterized
// sibling — e.g. contender pointed at a specific builder.
export async function upRecipe(
  name: string,
  recipeIn: Recipe,
  override?: TargetOverride,
  opts: { attached?: boolean; runtimeDir?: string; summarize?: boolean } = {},
): Promise<UpOutcome> {
  const runtimeDir = opts.runtimeDir ?? RUNTIME_DIR;
  const recipe = applyTargetOverride(recipeIn, override);
  let renderers: Renderer[] = [];
  let paths: RendererPaths = { runtimeDir, manifestDir: "" };

  rule(name);

  await cleanRuntime(runtimeDir);

  if (recipe.artifacts) {
    const sArt = step("generating artifacts");
    try {
      await generateArtifacts(recipe);
    } catch (e) {
      fail(sArt, (e as Error).message);
      return { code: 1, renderers, paths, recipe };
    }
    done(sArt, `${recipe.artifacts.generator}/${recipe.artifacts.fork}`);
  }

  const sEmit = step("rendering manifests");
  const emitted = await emit(name, recipe, { attached: opts.attached, runtimeDir });
  const imageBuilds = emitted.imageBuilds;
  renderers = emitted.selected;
  paths = emitted.paths;
  done(sEmit, renderers.map((r) => r.name).join(" + "));

  const missingTools = missingBinaries(renderers.flatMap((r) => r.requiredBinaries ?? []));
  if (missingTools.length > 0) {
    console.error("");
    console.error(red("✗ please install the following dependencies:"));
    for (const t of missingTools) console.error(`    ${t}`);
    console.error("");
    return { code: 1, renderers, paths, recipe };
  }

  // Binaries built from source (binaryBuilds) are produced below, so they are
  // not expected to exist yet — only check the unmanaged ones.
  const missing = missingBinaries(emitted.binaries.filter((b) => !emitted.binaryBuilds.has(b)));
  if (missing.length > 0) {
    console.error("");
    console.error(red("✗ host binaries not found:"));
    for (const b of missing) console.error(`    ${b}`);
    console.error("");
    console.error(`  ${dim("place them in ./bin/, set 'binary' in the recipe, or install on PATH")}`);
    return { code: 1, renderers, paths, recipe };
  }

  if (emitted.binaryBuilds.size > 0) {
    rule("binaries");
    const t = performance.now();
    try {
      const built = await ensureBinaries(emitted.binaryBuilds);
      const skipped = emitted.binaryBuilds.size - built.length;
      const extra = built.length > 0
        ? `built ${built.length}${skipped > 0 ? `, cached ${skipped}` : ""}`
        : `cached ${skipped}`;
      note("✓", `binaries ready ${dim(`(${extra})`)}`, t);
    } catch (e) {
      console.error(red(`✗ binary build failed: ${(e as Error).message}`));
      return { code: 1, renderers, paths, recipe };
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
      return { code: 1, renderers, paths, recipe };
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
      return { code, renderers, paths, recipe };
    }
    done(sp);
  }

  for (const r of procs) {
    rule(r.slot);
    const t = performance.now();
    const code = await r.start!(paths);
    if (code !== 0) {
      console.error(red(`✗ ${r.name} start failed`));
      return { code, renderers, paths, recipe };
    }
    note("✓", `${r.name} started`, t);
  }

  // Ports/URLs print before the scripts run, so they're at hand while a
  // long-running script (or one that fails) holds the terminal.
  if (opts.summarize) {
    printServices(recipe);
    printSummary(renderers, paths, recipe);
  }

  // Scripts run once everything is up — pods and processes alike. A script
  // that needs a specific moment (e.g. relay-warmup's pre-genesis window)
  // waits for it itself.
  if ((recipe.scripts ?? []).length > 0) {
    rule("scripts");
    for (const script of recipe.scripts ?? []) {
      const label = script.name || "script";
      const t = performance.now();
      // Static marker, not the step() spinner: scripts print their own output
      // below this line, which a same-line spinner redraw would garble.
      note("⏳", label);
      try {
        await script(recipe);
        note("✓", label, t);
      } catch (e) {
        console.error(red(`✗ ${label} failed: ${(e as Error).message}`));
        return { code: 1, renderers, paths, recipe };
      }
    }
  }

  return { code: 0, renderers, paths, recipe };
}

export async function up(
  arg?: string,
  override?: TargetOverride,
  opts: { attached?: boolean; runtimeDir?: string; scripts?: string[] } = {},
): Promise<number> {
  const input = await resolveInput(arg);
  if (input.kind === "project") return await upProject("up", input.path, opts.scripts);
  return (await upRecipeFile(input.ref, override, opts)).code;
}

export const command = new Command()
  .description("Start a recipe and detach")
  .option("--pods <renderer:string>", "Override recipe target for pods")
  .option("--processes <renderer:string>", "Override recipe target for processes")
  .option("--script <path:string>", "Append a script module to the recipe (repeatable)", { collect: true })
  .arguments("[input:string]")
  .action(async (opts, arg?: string) => {
    const override: TargetOverride = { pods: opts.pods, processes: opts.processes };
    const input = await resolveInput(arg);
    if (input.kind === "project") {
      Deno.exit(await upProject("up", input.path, opts.script));
    }
    const out = await upRecipeFile(input.ref, override, { scripts: opts.script, summarize: true });
    Deno.exit(out.code);
  });
