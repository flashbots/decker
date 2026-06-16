import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { DEFAULT_MANIFEST, intoDir, isCloned, loadManifest, pull } from "../utils/manifest.ts";
import { red, rule, warn } from "../utils/term.ts";

export const command = new Command()
  .description("Clone the pinned decker source into .decker/ (skips an existing clone)")
  .action(async () => {
    let manifest;
    try {
      manifest = await loadManifest(DEFAULT_MANIFEST);
    } catch (e) {
      console.error(red(`✗ ${(e as Error).message}`));
      Deno.exit(1);
    }
    if (await isCloned(manifest.project)) {
      const dst = intoDir(manifest.project);
      console.error(warn(`! ${dst} already exists — leaving it untouched (it may hold local changes); remove it to re-pull`));
      return;
    }
    rule("pull");
    try {
      await pull(manifest.project);
    } catch (e) {
      console.error(red(`✗ ${(e as Error).message}`));
      Deno.exit(1);
    }
  });
