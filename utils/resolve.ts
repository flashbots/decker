import { isAbsolute, join } from "jsr:@std/path@^1.0.0";
import { portNum } from "./types.ts";
import type { ContainerDef, Ctx, HostCtx, Pod, ProcessDef, Prototype, PrototypeOverrides, Recipe } from "./types.ts";

import { DECKER_ROOT } from "./root.ts";

const CONTAINERS_DIR = new URL("../containers/", import.meta.url);

const PROTOS: Record<string, Prototype> = await loadPrototypes();

async function loadPrototypes(): Promise<Record<string, Prototype>> {
  const out: Record<string, Prototype> = {};
  for await (const entry of Deno.readDir(CONTAINERS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const name = entry.name.slice(0, -3);
    const mod = await import(new URL(entry.name, CONTAINERS_DIR).href);
    if (typeof mod.ports !== "object") {
      throw new Error(`containers/${entry.name} must export "ports"`);
    }
    if (typeof mod.buildContainer !== "function" && typeof mod.buildProcess !== "function") {
      throw new Error(`containers/${entry.name} must export "buildContainer" and/or "buildProcess"`);
    }
    out[name] = {
      ports: mod.ports,
      buildContainer: mod.buildContainer,
      buildProcess: mod.buildProcess,
      webui: mod.webui,
    };
  }
  return out;
}

export function lookup(p: string | Prototype): Prototype {
  if (typeof p !== "string") return p;
  const proto = PROTOS[p];
  if (!proto) throw new Error(`unknown prototype ${p}`);
  return proto;
}

// Add or override entries in the prototype registry from a decker.ts manifest's
// `prototypes`. Each entry is overlaid field-wise on any existing prototype of
// the same name, so an override can change just one aspect (e.g. a container's
// image) while keeping the rest, and the same name in `pods` and `processes`
// composes into one prototype. Call this before rendering, so later `lookup`s of
// a recipe's string prototype names see the manifest's versions.
export function registerPrototypes(overrides?: PrototypeOverrides): void {
  if (!overrides) return;
  const apply = (entries?: Record<string, Prototype>) => {
    for (const [name, proto] of Object.entries(entries ?? {})) {
      PROTOS[name] = { ...PROTOS[name], ...proto };
    }
  };
  apply(overrides.pods);
  apply(overrides.processes);
}

export type Located =
  | { kind: "container"; pod: Pod; def: ContainerDef }
  | { kind: "process"; def: ProcessDef };

export function findComponent(recipe: Recipe, name: string): Located {
  for (const pod of recipe.pods) {
    const def = pod.containers.find((c) => c.name === name);
    if (def) return { kind: "container", pod, def };
  }
  for (const def of recipe.processes ?? []) {
    if (def.name === name) return { kind: "process", def };
  }
  throw new Error(`no component ${name}`);
}

function urlFor(recipe: Recipe, name: string, portName: string, host: (loc: Located) => string): string {
  const loc = findComponent(recipe, name);
  const proto = lookup(loc.def.prototype);
  const override = (loc.def.config?.ports as Record<string, unknown> | undefined)?.[portName];
  const port = override ?? proto.ports[portName];
  if (port === undefined) {
    const label = typeof loc.def.prototype === "string" ? loc.def.prototype : "<inline>";
    throw new Error(`no port ${portName} on ${name} (${label})`);
  }
  return `http://${host(loc)}:${portNum(port as Parameters<typeof portNum>[0])}`;
}

export function makeCtx(recipe: Recipe, host: (loc: Located) => string): Ctx {
  return {
    url: (name, portName) => urlFor(recipe, name, portName, host),
    artifactsHostPath: resolveArtifactsHostPath(recipe),
  };
}

function resolveArtifactsHostPath(recipe: Recipe): string {
  const p = recipe.artifactsHostPath ?? "runtime/artifacts";
  if (p.includes("${DECKER_ROOT}")) return p.replaceAll("${DECKER_ROOT}", DECKER_ROOT);
  return isAbsolute(p) ? p : join(DECKER_ROOT, p);
}

export function makeHostCtx(
  recipe: Recipe,
  host: (loc: Located) => string,
  artifactsPath: string,
  dataPath: (name: string, volumeName: string) => string,
  configPath: (name: string, filename: string) => string,
  binary: (def: ProcessDef, defaultName: string) => string,
): HostCtx {
  return { ...makeCtx(recipe, host), artifactsPath, dataPath, configPath, binary };
}
