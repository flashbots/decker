import type { Prototype, Recipe } from "../../utils/types.ts";

// Same single sleeper pod as minimal.ts, but this recipe ships its OWN post-up
// script. A project manifest's `scripts` REPLACE it, so a decker.ts pointing
// here with its own scripts must NOT leave this marker behind (see scripts_test).
const sleeper: Prototype = {
  ports: {},
  buildContainer: () => ({
    container: {
      image: "busybox:1.36",
      command: ["sh", "-c"],
      args: ["sleep 3600"],
    },
  }),
};

export const recipe: Recipe = {
  pods: [
    { name: "sleeper", containers: [{ name: "sleeper", prototype: sleeper }] },
  ],
  scripts: [
    () => {
      const path = Deno.env.get("RECIPE_SCRIPT_MARKER");
      if (path) Deno.writeTextFileSync(path, "recipe-script-ran");
    },
  ],
};
