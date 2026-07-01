import type { ContainerResult, ContainerDef, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

export const ports: Ports = {
  http: 3500,
  "p2p-tcp": { port: 9000, protocol: "TCP", service: false },
  "p2p-udp": { port: 9000, protocol: "UDP", service: false },
  quic:      { port: 9100, protocol: "UDP", service: false },
};

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const el = def.refs?.el;
  const builder = def.refs?.builder;
  if (!el) throw new Error(`beacon ${def.name}: missing refs.el`);
  const ps = (def.config?.ports as Ports | undefined) ?? ports;

  // Peers to dial explicitly. Prefer config.peers (a list, for a full mesh);
  // fall back to the legacy single refs.peer. Every beacon dials every other so
  // connectivity never hinges on a single reciprocated link.
  const peerNames = (def.config?.peers as string[] | undefined) ??
    (def.refs?.peer ? [def.refs.peer] : []);
  const peerMultiaddrs = peerNames.map((p) => {
    const u = new URL(ctx.url(p, "p2p-tcp"));
    return `/dns4/${u.hostname}/tcp/${u.port}`;
  });

  // Post-Fulu (PeerDAS), blobs are distributed as data columns and a plain node
  // custodies only CUSTODY_REQUIREMENT (4 of 128). The legacy blob_sidecars
  // endpoint (used by e.g. blobscan's indexer) then 400s because it can't
  // reconstruct blobs from <64 columns. `config.supernode: true` makes this node
  // custody all columns so it can serve full blobs — required on a single-node
  // devnet where there are no peers to sample the missing columns from.
  const supernode = def.config?.supernode === true;
  return {
    container: {
      image: "docker.io/sigp/lighthouse:v8.1.0",
      command: ["lighthouse"],
      args: [
        "bn",
        "--datadir", "/data_beacon",
        "--testnet-dir", "/artifacts/testnet",
        "--enable-private-discovery",
        "--disable-peer-scoring",
        "--staking",
        "--enr-address", "127.0.0.1",
        "--enr-udp-port", String(portNum(ps["p2p-udp"])),
        "--enr-tcp-port", String(portNum(ps["p2p-tcp"])),
        "--enr-quic-port", String(portNum(ps.quic)),
        "--port", String(portNum(ps["p2p-tcp"])),
        "--quic-port", String(portNum(ps.quic)),
        "--http",
        "--http-port", String(portNum(ps.http)),
        "--http-address", "0.0.0.0",
        "--http-allow-origin", "*",
        "--disable-packet-filter",
        "--target-peers", peerNames.length > 0 ? "5" : "0",
        "--execution-endpoint", ctx.url(el, "authrpc"),
        "--execution-jwt", "/artifacts/jwtsecret",
        "--always-prepare-payload",
        "--prepare-payload-lookahead", "8000",
        "--suggested-fee-recipient", "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
        ...(supernode ? ["--supernode"] : []),
        ...(peerMultiaddrs.length > 0 ? ["--libp2p-addresses", peerMultiaddrs.join(",")] : []),
        ...(builder ? [
          "--builder", ctx.url(builder, "http"),
          "--builder-fallback-epochs-since-finalization", "0",
          "--builder-fallback-disable-checks",
        ] : []),
      ],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_beacon" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}
