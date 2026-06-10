// A standalone decker manifest.
//
// Copy this to decker.ts (or `decker spit`) and tweak.
// Then run `decker pull` to clone+pin, followed by `decker start` or `decker up`.

type DeckerProject = {
  decker: {
    source: string;
    commit: string;
    into?: string;
  };
  recipe: string;
};

export const project: DeckerProject = {
  decker: {
    source: "https://github.com/flashbots/decker.git",
    commit: "0000000000000000000000000000000000000000",
    into: ".decker",
  },
  recipe: "l1",
};
