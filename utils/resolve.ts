import { portNum } from "./types.ts";
import type { ContainerDef, Ctx, Pod, Prototype, Recipe } from "./types.ts";

const CONTAINERS_DIR = new URL("../containers/", import.meta.url);

const PROTOS: Record<string, Prototype> = await loadPrototypes();

async function loadPrototypes(): Promise<Record<string, Prototype>> {
  const out: Record<string, Prototype> = {};
  for await (const entry of Deno.readDir(CONTAINERS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const name = entry.name.slice(0, -3);
    const mod = await import(new URL(entry.name, CONTAINERS_DIR).href);
    if (typeof mod.build !== "function" || typeof mod.ports !== "object") {
      throw new Error(`containers/${entry.name} must export "ports" and "build"`);
    }
    out[name] = { ports: mod.ports, build: mod.build };
  }
  return out;
}

export function lookup(p: string | Prototype): Prototype {
  if (typeof p !== "string") return p;
  const proto = PROTOS[p];
  if (!proto) throw new Error(`unknown prototype ${p}`);
  return proto;
}

export function findContainer(
  recipe: Recipe,
  containerName: string,
): { pod: Pod; container: ContainerDef } {
  for (const pod of recipe.pods) {
    const container = pod.containers.find((c) => c.name === containerName);
    if (container) return { pod, container };
  }
  throw new Error(`no container ${containerName}`);
}

export function makeCtx(recipe: Recipe, host: (containerName: string) => string): Ctx {
  return {
    url(containerName, portName) {
      const { container } = findContainer(recipe, containerName);
      const proto = lookup(container.prototype);
      const port = proto.ports[portName];
      if (port === undefined) {
        const label = typeof container.prototype === "string" ? container.prototype : "<inline>";
        throw new Error(`no port ${portName} on ${containerName} (${label})`);
      }
      return `http://${host(containerName)}:${portNum(port)}`;
    },
  };
}
