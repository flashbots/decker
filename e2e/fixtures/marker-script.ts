import type { Recipe, Script } from "../../utils/types.ts";

// Writes a marker file so tests can confirm this script actually ran against
// the recipe it was appended to. Path comes from SCRIPT_MARKER_PATH so the
// same fixture works across tmp dirs.
export const script: Script = async (recipe: Recipe) => {
  const path = Deno.env.get("SCRIPT_MARKER_PATH");
  if (!path) throw new Error("SCRIPT_MARKER_PATH not set");
  await Deno.writeTextFile(path, JSON.stringify({ pods: recipe.pods.map((p) => p.name) }));
};
