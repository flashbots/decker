import { stringify } from "jsr:@std/yaml@^1.0.5";
import { dirname, isAbsolute } from "jsr:@std/path@^1.0.0";
import { renderPodman } from "./render-podman.ts";
import { renderDeploy } from "./render-deploy.ts";
import { renderProcessCompose } from "./render-process-compose.ts";
import type { Recipe } from "./types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function resolve(recipe: Recipe): Recipe {
  const p = recipe.artifactsHostPath ?? ".runtime/artifacts";
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
};

export async function emit(name: string, recipe: Recipe): Promise<EmitResult> {
  validate(recipe);
  recipe = resolve(recipe);
  const outDir = `${DECKER_ROOT}/manifests/${name}`;
  await Deno.mkdir(`${outDir}/deploy`, { recursive: true });
  const podmanDocs = renderPodman(recipe);
  const podmanBody = podmanDocs.map((d) => stringify(d, yamlOpts)).join("---\n");
  await Deno.writeTextFile(`${outDir}/podman.yaml`, podmanBody);

  const deployFiles = renderDeploy(recipe);
  for (const f of deployFiles) {
    const body = f.docs.map((d) => stringify(d, yamlOpts)).join("---\n");
    await Deno.writeTextFile(`${outDir}/deploy/${f.filename}`, body);
  }

  const pc = renderProcessCompose(recipe, `\${DECKER_ROOT}/.runtime`);
  let binaries: string[] = [];
  if (pc) {
    binaries = pc.binaries;
    await Deno.writeTextFile(`${outDir}/process-compose.yaml`, stringify(pc.doc, yamlOpts));
    for (const f of pc.files) {
      const full = `${outDir}/${f.relPath}`;
      await Deno.mkdir(dirname(full), { recursive: true });
      await Deno.writeTextFile(full, f.content);
    }
  }

  await materializeRuntime(outDir);
  return { binaries };
}

async function materializeRuntime(outDir: string) {
  const runtimeDir = `${DECKER_ROOT}/.runtime`;
  await Deno.remove(runtimeDir, { recursive: true }).catch(() => {});
  await copyExpanded(outDir, runtimeDir);
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
