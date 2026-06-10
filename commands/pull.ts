import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { DEFAULT_MANIFEST, loadManifest, pull } from "../utils/manifest.ts";
import { red, rule } from "../utils/term.ts";

export const command = new Command()
  .description("Clone the pinned decker source into .decker/ (or update an existing clone)")
  .action(async () => {
    let manifest;
    try {
      manifest = await loadManifest(DEFAULT_MANIFEST);
    } catch (e) {
      console.error(red(`✗ ${(e as Error).message}`));
      Deno.exit(1);
    }
    rule("pull");
    try {
      await pull(manifest.project);
    } catch (e) {
      console.error(red(`✗ ${(e as Error).message}`));
      Deno.exit(1);
    }
  });
