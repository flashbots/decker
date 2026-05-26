import { portNum } from "./types.ts";
import type { ContainerDef, Ctx, HostCtx, Pod, ProcessDef, Prototype, Recipe } from "./types.ts";

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
  const port = proto.ports[portName];
  if (port === undefined) {
    const label = typeof loc.def.prototype === "string" ? loc.def.prototype : "<inline>";
    throw new Error(`no port ${portName} on ${name} (${label})`);
  }
  return `http://${host(loc)}:${portNum(port)}`;
}

export function makeCtx(recipe: Recipe, host: (loc: Located) => string): Ctx {
  return {
    url: (name, portName) => urlFor(recipe, name, portName, host),
  };
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
