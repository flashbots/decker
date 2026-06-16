import { dirname, isAbsolute } from "jsr:@std/path@^1.0.0";
import { rendererFor } from "./renderers.ts";
import type { ImageBuildSpec, Recipe, Renderer, RendererPaths } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";
const RUNTIME_DIR = `${DECKER_ROOT}/runtime`;

function resolve(recipe: Recipe): Recipe {
  const p = recipe.artifactsHostPath ?? "runtime/artifacts";
  return { ...recipe, artifactsHostPath: isAbsolute(p) ? p : `\${DECKER_ROOT}/${p}` };
}

function validate(recipe: Recipe) {
  const podNames = new Set<string>();
  const seen = new Set<string>();
  for (const pod of recipe.pods) {
    if (podNames.has(pod.name)) throw new Error(`duplicate pod name: ${pod.name}`);
    podNames.add(pod.name);
    for (const c of pod.containers) {
      if (seen.has(c.name)) throw new Error(`duplicate name: ${c.name}`);
      seen.add(c.name);
    }
  }
  for (const p of recipe.processes ?? []) {
    if (seen.has(p.name)) throw new Error(`duplicate name: ${p.name}`);
    seen.add(p.name);
  }
}

export type EmitResult = {
  binaries: string[];
  imageBuilds: Map<string, ImageBuildSpec>;
  selected: Renderer[];
  paths: RendererPaths;
};

export async function emit(
  name: string,
  recipe: Recipe,
  opts: { attached?: boolean; runtimeDir?: string } = {},
): Promise<EmitResult> {
  validate(recipe);
  recipe = resolve(recipe);
  const manifestDir = `${DECKER_ROOT}/manifests/${name}`;
  const runtimeDir = opts.runtimeDir ?? `${DECKER_ROOT}/runtime`;
  const ctx = { manifestRoot: `\${DECKER_ROOT}/runtime`, attached: opts.attached };

  const selected: Renderer[] = [rendererFor("pods", recipe.target?.pods)];
  if ((recipe.processes ?? []).length > 0) {
    selected.push(rendererFor("processes", recipe.target?.processes));
  }

  try {
    await Deno.remove(manifestDir, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Deno.mkdir(manifestDir, { recursive: true });

  const imageBuilds = new Map<string, ImageBuildSpec>();
  const binaries: string[] = [];
  for (const r of selected) {
    const out = r.render(recipe, ctx);
    for (const f of out.files) {
      const full = `${manifestDir}/${f.relPath}`;
      await Deno.mkdir(dirname(full), { recursive: true });
      await Deno.writeTextFile(full, f.content);
    }
    if (out.imageBuilds) {
      for (const [tag, spec] of out.imageBuilds) {
        const existing = imageBuilds.get(tag);
        if (existing) {
          if (existing.repo !== spec.repo || existing.ref !== spec.ref || existing.cmd !== spec.cmd) {
            throw new Error(`image tag ${tag} produced by conflicting ImageBuildSpec`);
          }
        } else {
          imageBuilds.set(tag, spec);
        }
      }
    }
    if (out.binaries) binaries.push(...out.binaries);
  }

  await materializeRuntime(manifestDir, runtimeDir);
  return { binaries, imageBuilds, selected, paths: { runtimeDir, manifestDir } };
}

// Callers run this before generating artifacts, so the dir is empty when
// artifacts land in it and materialize is a plain copy — no wipe, no exception.
export async function cleanRuntime(runtimeDir: string = RUNTIME_DIR): Promise<void> {
  try {
    await Deno.remove(runtimeDir, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

async function materializeRuntime(manifestDir: string, runtimeDir: string) {
  await copyExpanded(manifestDir, runtimeDir);
}

async function copyExpanded(src: string, dest: string) {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyExpanded(srcPath, destPath);
    } else if (entry.isFile) {
      const txt = await Deno.readTextFile(srcPath);
      await Deno.writeTextFile(destPath, txt.replaceAll("${DECKER_ROOT}", DECKER_ROOT));
    }
  }
}
