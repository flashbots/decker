import { stringify } from "jsr:@std/yaml@^1.0.5";
import { isAbsolute, join } from "jsr:@std/path@^1.0.0";
import { renderLocal } from "./render-local.ts";
import { renderDeploy } from "./render-deploy.ts";
import type { Recipe } from "./types.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function resolve(recipe: Recipe): Recipe {
  const p = recipe.artifactsHostPath ?? "artifacts";
  return { ...recipe, artifactsHostPath: isAbsolute(p) ? p : join(REPO_ROOT, p) };
}

function validate(recipe: Recipe) {
  const podNames = new Set<string>();
  const containerNames = new Set<string>();
  for (const pod of recipe.pods) {
    if (podNames.has(pod.name)) throw new Error(`duplicate pod name: ${pod.name}`);
    podNames.add(pod.name);
    for (const c of pod.containers) {
      if (containerNames.has(c.name)) {
        throw new Error(`duplicate container name: ${c.name}`);
      }
      containerNames.add(c.name);
    }
  }
}

export async function emit(name: string, recipe: Recipe) {
  validate(recipe);
  recipe = resolve(recipe);
  const outDir = `${REPO_ROOT}manifests/${name}`;
  await Deno.mkdir(`${outDir}/deploy`, { recursive: true });
  const localDocs = renderLocal(recipe);
  const localBody = localDocs.map((d) => stringify(d, yamlOpts)).join("---\n");
  await Deno.writeTextFile(`${outDir}/local.yaml`, localBody);
  console.log(`wrote ${outDir}/local.yaml`);

  const deployFiles = renderDeploy(recipe);
  for (const f of deployFiles) {
    const body = f.docs.map((d) => stringify(d, yamlOpts)).join("---\n");
    await Deno.writeTextFile(`${outDir}/deploy/${f.filename}`, body);
    console.log(`wrote ${outDir}/deploy/${f.filename}`);
  }
}
