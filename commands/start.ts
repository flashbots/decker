import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { loadRecipe } from "../utils/build.ts";
import { lookup } from "../utils/resolve.ts";
import { portNum } from "../utils/types.ts";
import { DOZZLE_PORT } from "../utils/render-local.ts";
import { down } from "./down.ts";
import { up } from "./up.ts";

async function advertise(target: string) {
  if (target.endsWith(".yaml")) return;
  const { recipe } = await loadRecipe(target);
  console.log("");
  for (const pod of recipe.pods) {
    for (const c of pod.containers) {
      const proto = lookup(c.prototype);
      const entries = Object.entries(proto.ports);
      if (entries.length === 0) {
        console.log(`  ${c.name}`);
        continue;
      }
      console.log(`  ${c.name}:`);
      for (const [name, spec] of entries) {
        console.log(`    ${name.padEnd(10)} ${portNum(spec)}`);
      }
    }
  }
  console.log("");
  console.log(`  dozzle:    http://localhost:${DOZZLE_PORT}`);
  console.log("");
}

export const command = new Command()
  .description("Up a recipe, advertise ports, and down on Ctrl+C")
  .arguments("<target:string>")
  .action(async (_, target: string) => {
    const code = await up(target);
    if (code !== 0) Deno.exit(code);
    await advertise(target);

    let downing = false;
    const stop = async () => {
      if (downing) return;
      downing = true;
      console.log("\nstopping…");
      const c = await down();
      Deno.exit(c);
    };
    Deno.addSignalListener("SIGINT", stop);
    Deno.addSignalListener("SIGTERM", stop);

    await new Promise(() => {});
  });
