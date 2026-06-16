import type { Prototype, Recipe } from "../../utils/types.ts";

// Smallest possible pod: a single busybox container that just sleeps. No
// artifacts (no genesis), no heavy images — so a real `up`/`down` launch smoke
// pulls in seconds and is reliable in CI.
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
};
