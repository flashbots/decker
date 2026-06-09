// A standalone decker manifest.
//
// Copy this to decker.ts (or `decker spit`) and tweak.
// Then run `decker up` or `decker start` from this directory.

type DeckerProject = {
  decker: {
    source?: string;
    ref?: string;
    into?: string;
  };
  recipe: string;
};

export const project: DeckerProject = {
  decker: {
    source: "https://github.com/flashbots/decker.git",
    ref: "main",
    into: ".decker",
  },
  recipe: "l1",
};
