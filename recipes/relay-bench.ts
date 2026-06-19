import type { Recipe } from "../utils/types.ts";
import { benchmarkRelays, defaultTargets } from "../scripts/relay-bench.ts";

// Parent: no devnet of its own. Its script benchmarks each relay in both sync and
// optimistic mode — bringing up a fresh single-relay devnet per (relay, mode),
// loading the one builder, measuring from the relay's native metrics, tearing it
// down — then prints the comparison. `decker up relay-bench` runs the whole thing.
export const recipe: Recipe = {
  pods: [],
  scripts: [benchmarkRelays(await defaultTargets())],
};
