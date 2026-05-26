import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const RECIPES_DIR = `${DECKER_ROOT}/recipes/`;
const CONTAINERS_DIR = `${DECKER_ROOT}/containers/`;

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function spit(src: string, dst: string, force: boolean) {
  if (!force && await exists(dst)) {
    throw new Error(`${dst} exists (use --force to overwrite)`);
  }
  await Deno.copyFile(src, dst);
  console.log(`wrote ${dst}`);
}

export const command = new Command()
  .description("Spit a recipe (→ decker.ts) or container (→ <name>.ts) into cwd")
  .option("-f, --force", "overwrite existing file")
  .arguments("[name:string]")
  .action(async ({ force }, name?: string) => {
    const cwd = Deno.cwd();
    const target = name ?? "example";
    const recipePath = `${RECIPES_DIR}${target}.ts`;
    if (await exists(recipePath)) {
      await spit(recipePath, `${cwd}/decker.ts`, !!force);
      return;
    }
    const containerPath = `${CONTAINERS_DIR}${target}.ts`;
    if (await exists(containerPath)) {
      await spit(containerPath, `${cwd}/${target}.ts`, !!force);
      return;
    }
    throw new Error(`no recipe or container named '${target}'`);
  });
