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
  const peer = def.refs?.peer;
  if (!el) throw new Error(`beacon ${def.name}: missing refs.el`);
  const ps = (def.config?.ports as Ports | undefined) ?? ports;
  const peerMultiaddr = peer ? (() => {
    const u = new URL(ctx.url(peer, "p2p-tcp"));
    return `/dns4/${u.hostname}/tcp/${u.port}`;
  })() : "";
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
        "--target-peers", peer ? "1" : "0",
        "--execution-endpoint", ctx.url(el, "authrpc"),
        "--execution-jwt", "/artifacts/jwtsecret",
        "--always-prepare-payload",
        "--prepare-payload-lookahead", "8000",
        "--suggested-fee-recipient", "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
        "--libp2p-addresses", peerMultiaddr,
        ...(builder ? ["--builder", ctx.url(builder, "http")] : []),
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
