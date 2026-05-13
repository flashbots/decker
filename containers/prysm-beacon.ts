import type { BuildResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {
  http: 3500,
  rpc:  { port: 4000, protocol: "TCP" as const, service: true },
  "p2p-tcp": { port: 9000, protocol: "TCP" as const, service: false },
  "p2p-udp": { port: 9000, protocol: "UDP" as const, service: false },
  quic:      { port: 9100, protocol: "UDP" as const, service: false },
};

export function build(def: ContainerDef, ctx: Ctx): BuildResult {
  const el = def.refs?.el;
  if (!el) throw new Error(`prysm-beacon ${def.name}: missing refs.el`);
  const builder = def.refs?.builder;
  const args = [
    "--accept-terms-of-use",
    "--datadir", "/data_beacon",
    "--chain-config-file", "/artifacts/testnet/config.yaml",
    "--genesis-state", "/artifacts/testnet/genesis.ssz",
    "--contract-deployment-block", "0",
    "--execution-endpoint", ctx.url(el, "authrpc"),
    "--jwt-secret", "/artifacts/jwtsecret",
    "--p2p-host-ip", "127.0.0.1",
    "--p2p-tcp-port", String(ports["p2p-tcp"].port),
    "--p2p-udp-port", String(ports["p2p-udp"].port),
    "--p2p-quic-port", String(ports.quic.port),
    "--rpc-host", "0.0.0.0",
    "--rpc-port", String(ports.rpc.port),
    "--grpc-gateway-host", "0.0.0.0",
    "--grpc-gateway-port", String(ports.http),
    "--grpc-gateway-corsdomain", "*",
    "--suggested-fee-recipient", "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
    "--peer", "",
    "--minimum-peers-per-subnet", "0",
    "--min-sync-peers", "0",
    "--disable-peer-scorer",
    "--no-discovery",
    "--enable-builder-ssz",
    "--force-clear-db",
  ];
  if (builder) {
    args.push("--http-mev-relay", ctx.url(builder, "http"));
  }
  return {
    container: {
      image: "gcr.io/prysmaticlabs/prysm/beacon-chain:stable",
      command: ["/app/cmd/beacon-chain/beacon-chain"],
      args,
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
