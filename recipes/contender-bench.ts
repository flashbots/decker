import type { Recipe } from "../utils/types.ts";

// A standalone bench recipe: contender only, run as a sibling of an already-up
// devnet. Driving it through decker's own up() means the recipe's `target`
// picks the engine — the script that launches it stays runtime-agnostic.
//
// It reaches the builder by pod name (`rbuilder-1`), which works on any engine
// as long as the two recipes share a network. That's the cross-recipe seam: no
// refs cross the boundary, so the address is injected here as plain config.
//
// No `artifacts`: contender is a pure client and consumes none, so up() skips
// generation entirely.
export function contenderBench(
  opts: { rpcUrl: string; txsUrl?: string; duration?: number; privKey?: string },
): Recipe {
  return {
    pods: [
      {
        name: "contender",
        containers: [
          {
            name: "contender",
            prototype: "contender",
            config: {
              rpcUrl: opts.rpcUrl,
              duration: opts.duration ?? 30,
              ...(opts.txsUrl ? { txsUrl: opts.txsUrl } : {}),
              ...(opts.privKey ? { privKey: opts.privKey } : {}),
            },
          },
        ],
      },
    ],
  };
}

// Default for `decker up contender-bench`: target rbuilder-1.
export const recipe: Recipe = contenderBench({ rpcUrl: "http://rbuilder-1:8745" });
