// Example: bring up the contender bench recipe through decker's own up().
// The recipe's `target` decides the engine (podman/docker), so nothing
// runtime-specific — no engine binary, no host-gateway name — lives here.
//
//   deno run -A scripts/contender-bench.ts
//
// Requires the devnet already up and on the same network, so contender resolves
// the builder by pod name.

import { up } from "../commands/up.ts";

const BENCH_RECIPE = "recipes/contender-bench.ts";

if (import.meta.main) {
  Deno.exit(await up(BENCH_RECIPE, undefined, { attached: true }));
}
