import type { ContainerDef, ContainerResult, Ports } from "../utils/types.ts";

// Serves the disallow list the helix simulator polls (--blacklist-provider): a
// flat JSON array of addresses. The simulator refetches every 5 minutes — the
// first fetch is at startup, so if this container isn't up yet the list stays
// empty until the next tick — and then rejects any submission whose block
// touches one of these accounts, provided the caller asked for it
// (mev-boost-relay always sends apply_blacklist: true).
//
// Port/path mirror the simulator's own default endpoint, so the wiring reads the
// same as production. helix-simulator defaults to this path too, but takes it as
// config rather than importing it — the provider needn't be this container.

const PORT = 3520;
export const BLACKLIST_PATH = "/blacklist";

export const ports: Ports = {
  http: PORT,
};

function server(addresses: string[]): string {
  return `
const LIST = ${JSON.stringify(addresses)};

Deno.serve({ port: ${PORT}, hostname: "0.0.0.0" }, (req) => {
  if (new URL(req.url).pathname !== "${BLACKLIST_PATH}") return new Response("not found", { status: 404 });
  return Response.json(LIST);
});
`;
}

export function buildContainer(def: ContainerDef): ContainerResult {
  const addresses = (def.config?.addresses as string[] | undefined) ?? [];
  return {
    container: {
      image: "docker.io/denoland/deno:alpine",
      command: ["deno", "run", "--allow-net", "/blacklist.ts"],
      ports,
    },
    configs: [
      { filename: "blacklist.ts", content: server(addresses), mountPath: "/blacklist.ts" },
    ],
  };
}
