import type { Recipe } from "../utils/types.ts";
import { benchmarkRelays } from "../scripts/relay-bench.ts";
import { recipe as helix } from "./relay/helix.ts";
import { recipe as mevBoostRelay } from "./relay/mev-boost-relay.ts";

// Parent: no devnet of its own. Its script brings up each base single-relay
// recipe in turn, loads it, measures, tears it down, and prints the comparison.
// `decker up relay-bench` runs the whole thing.
export const recipe: Recipe = {
  pods: [],
  scripts: [benchmarkRelays([
    { name: "helix", label: "helix-1", recipe: helix, relayPort: 4040 },
    { name: "mev-boost-relay", label: "mev-boost-relay-1", recipe: mevBoostRelay, relayPort: 9062 },
  ])],
};
