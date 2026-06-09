import type { Renderer, RendererSlot } from "./types.ts";

const RENDERERS_DIR = new URL("../renderers/", import.meta.url);

const ALL: Renderer[] = await loadRenderers();

async function loadRenderers(): Promise<Renderer[]> {
  const out: Renderer[] = [];
  for await (const entry of Deno.readDir(RENDERERS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const mod = await import(new URL(entry.name, RENDERERS_DIR).href);
    if (!mod.renderer || typeof mod.renderer !== "object") {
      throw new Error(`renderers/${entry.name} must export 'renderer'`);
    }
    const r = mod.renderer as Renderer;
    if (typeof r.name !== "string" || (r.slot !== "pods" && r.slot !== "processes")) {
      throw new Error(`renderers/${entry.name} renderer missing name/slot`);
    }
    if (typeof r.render !== "function") {
      throw new Error(`renderers/${entry.name} renderer missing render()`);
    }
    out.push(r);
  }
  return out;
}

const DEFAULTS: Record<RendererSlot, string> = {
  pods: "podman",
  processes: "process-compose",
};

export function rendererFor(slot: RendererSlot, name?: string): Renderer {
  const want = name ?? DEFAULTS[slot];
  const found = ALL.find((r) => r.slot === slot && r.name === want);
  if (!found) {
    const known = ALL.filter((r) => r.slot === slot).map((r) => r.name).join(", ");
    throw new Error(`unknown ${slot} renderer: ${want} (known: ${known})`);
  }
  return found;
}

export function allRenderers(): Renderer[] {
  return ALL;
}
