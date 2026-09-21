// buildContainerFor is the seam every renderer goes through, so the generic
// `config.image` override belongs here: it is how ALP (and anyone) points a
// container at an already-built image without touching the prototype.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildContainerFor } from "./resolve.ts";
import type { ContainerDef, Ctx, Prototype } from "./types.ts";

const ctx: Ctx = { url: (n, p) => `http://${n}:${p}`, artifactsHostPath: "/artifacts" };

const proto: Prototype = {
  ports: { rpc: 8545 },
  buildContainer: () => ({
    container: { image: "upstream/image:pinned", ports: { rpc: 8545 } },
  }),
};

Deno.test("config.image replaces the prototype's image", () => {
  const def: ContainerDef = { name: "el-1", prototype: proto, config: { image: "reg/mine:v0" } };
  assertEquals(buildContainerFor(def, ctx).container.image, "reg/mine:v0");
});

Deno.test("no override, an empty one, or a non-string leaves the prototype's image", () => {
  for (const config of [undefined, {}, { image: "" }, { image: 7 }]) {
    const def: ContainerDef = { name: "el-1", prototype: proto, config } as ContainerDef;
    assertEquals(buildContainerFor(def, ctx).container.image, "upstream/image:pinned");
  }
});
