// A standalone decker manifest.
//
// Copy this to decker.ts (or `decker init`) and tweak.
// Then run `decker pull` to clone+pin, followed by `decker start` or `decker up`.

type DeckerProject = {
  decker: {
    source: string;
    ref: string;
    into?: string;
  };
  recipe: string;
  options?: Record<string, unknown>;
  scripts?: string[];
  target?: {
    pods?: string;
    processes?: string;
  };
};

export const project: DeckerProject = {
  decker: {
    source: "https://github.com/flashbots/decker.git",
    ref: "main", // pin to commit hash
    into: ".decker",
  },
  recipe: "l1",
  //
  // Recipe options - e.g. for opstack:
  // options: {
  //   l2Fork: "jovian",
  //   l2BlockTime: 1,
  //   externalBuilder: "op-rbuilder",
  // },
  //
  // Your own post-up hooks, run after the recipe's own scripts once the pods
  // are up. Import each module's `Script` at the top of this file and list them:
  //   import { script as myScript1 } from "./scripts/my-script-1.ts";
  //   import { script as myScript2 } from "./scripts/my-script-2.ts";
  // scripts: [myScript1, myScript2],
  //
  // Override the recipe's renderer targets. Default for pods is "podman";
  // switch to "docker-compose" to run on Docker instead.
  // target: {
  //   pods: "docker-compose",
  //   processes: "host",
  // },
};
