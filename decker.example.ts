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
  // Your own script modules, appended after the recipe's scripts (run once the
  // pods are up). Paths are relative to this file; each module must export
  // `script: (recipe) => Promise<void> | void`.
  // scripts: ["./scripts/warmup.ts"],
  // Override the recipe's renderer targets. Default for pods is "podman";
  // switch to "docker-compose" to run on Docker instead.
  // target: {
  //   pods: "docker-compose",
  //   processes: "host",
  // },
};
