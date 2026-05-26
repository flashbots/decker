import type { ContainerResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {
  http: 3500,
  "p2p-tcp": { port: 9000, protocol: "TCP", service: false },
  "p2p-udp": { port: 9000, protocol: "UDP", service: false },
  quic:      { port: 9100, protocol: "UDP", service: false },
} as const;

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const el = def.refs?.el;
  const builder = def.refs?.builder;
  if (!el) throw new Error(`beacon ${def.name}: missing refs.el`);
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
        "--enr-udp-port", String(ports["p2p-udp"].port),
        "--enr-tcp-port", String(ports["p2p-tcp"].port),
        "--enr-quic-port", String(ports.quic.port),
        "--port", String(ports["p2p-tcp"].port),
        "--quic-port", String(ports.quic.port),
        "--http",
        "--http-port", String(ports.http),
        "--http-address", "0.0.0.0",
        "--http-allow-origin", "*",
        "--disable-packet-filter",
        "--target-peers", "0",
        "--execution-endpoint", ctx.url(el, "authrpc"),
        "--execution-jwt", "/artifacts/jwtsecret",
        "--always-prepare-payload",
        "--prepare-payload-lookahead", "8000",
        "--suggested-fee-recipient", "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
        "--libp2p-addresses", "",
        ...(builder ? ["--builder", ctx.url(builder, "http")] : []),
      ],
      ports,
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
