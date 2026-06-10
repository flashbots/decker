// A standalone decker manifest.
//
// Copy this to decker.ts (or `decker spit`) and tweak.
// Then run `decker pull` to clone+pin, followed by `decker start` or `decker up`.

type DeckerProject = {
  decker: {
    source: string;
    ref: string;
    into?: string;
  };
  recipe: string;
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
  // Override the recipe's renderer targets. Default for pods is "podman";
  // switch to "docker-compose" to run on Docker instead.
  // target: {
  //   pods: "docker-compose",
  //   processes: "host",
  // },
};
