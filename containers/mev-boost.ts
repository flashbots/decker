import type { ContainerDef, ContainerResult, Ctx } from "../utils/types.ts";

export const ports = {
  http: 18550,
  // Prometheus metrics (enabled via --metrics below). Shifted off helix-sim's
  // 18551 to avoid a host-port collision in multi-relay.
  metrics: 18560,
};

const GENESIS_FORK_VERSION = "0x20000089";

type RelayEntry = { name: string; pubkey: string };

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const relays = (def.config?.relays as RelayEntry[] | undefined) ?? [];
  if (relays.length === 0) throw new Error(`mev-boost ${def.name}: config.relays must list at least one relay`);

  const relayArgs: string[] = [];
  for (const r of relays) {
    const url = new URL(ctx.url(r.name, "http"));
    relayArgs.push("--relay", `http://${r.pubkey}@${url.host}`);
  }

  const genesis = JSON.parse(Deno.readTextFileSync(`${ctx.artifactsHostPath}/genesis.json`));
  const genesisTimestamp = parseInt(genesis.timestamp, 16);

  return {
    container: {
      image: "docker.io/flashbots/mev-boost:latest",
      args: [
        "--addr", `0.0.0.0:${ports.http}`,
        "--loglevel", "info",
        "--metrics",
        "--metrics-addr", `0.0.0.0:${ports.metrics}`,
        ...relayArgs,
      ],
      env: {
        GENESIS_FORK_VERSION,
        GENESIS_TIMESTAMP: String(genesisTimestamp),
      },
      ports,
    },
  };
}
