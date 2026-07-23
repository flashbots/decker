// A standalone decker manifest.
//
// Copy this to decker.ts (or `decker init`) and tweak.
// Then run `decker pull` to clone+pin, followed by `decker start` or `decker up`.

// A post-up hook. Author each in its own module typed against decker's real
// `Script`/`Recipe` (from your clone); here the array just needs to accept them,
// so the parameter is left open.
type Script = (recipe: never) => void | Promise<void>;

// A Recipe value, or a Prototype value keyed by name in `prototypes`. Build
// these in their own modules typed against decker's real `Recipe`/`Prototype`
// (from your clone); here they're left open so this file stays self-contained.
type Recipe = Record<string, unknown>;
type Prototype = Record<string, unknown>;

type DeckerProject = {
  decker: {
    source: string;
    ref: string;
    into?: string;
  };
  // A recipe name (resolved in the clone) or an inline Recipe value.
  recipe: string | Recipe;
  options?: Record<string, unknown>;
  // Add or override the prototypes recipe containers/processes resolve by name.
  prototypes?: {
    pods?: Record<string, Prototype>;
    processes?: Record<string, Prototype>;
  };
  scripts?: Script[];
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
  // A recipe name (resolved against the clone's recipes/), or an inline Recipe
  // value imported or defined in this file:
  recipe: "l1",
  //
  // Recipe options - e.g. for opstack:
  // options: {
  //   l1Fork: "fulu",
  //   l2Fork: "karst",
  //   l2BlockTime: 1,
  //   externalBuilder: "op-rbuilder",
  //   // Run op-rbuilder as a host process instead of the pinned container
  //   builderBinary: "../op-rbuilder/target/profiling/op-rbuilder",
  // },
  //
  // Add or override the prototypes the recipe resolves by name — tweak a
  // built-in (keep its ports, swap the image) or introduce a new service.
  // Import or define and then do:
  //   prototypes: {
  //     pods: { "reth": myReth, "my-service": myService },
  //     processes: { "my-daemon": myDaemon },
  //   },
  //
  // Your own post-up hooks, run once the pods are up. Setting these REPLACES the
  // recipe's own scripts. Import each module's `script` at the top of this file
  // and list them:
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
