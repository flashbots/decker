import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";
import { EL_P2P_SECRET_KEY } from "./bootnode.ts";

// op-geth is the L2 execution engine (the sequencer's EL). op-node drives it
// over the engine API (authrpc). Default ports sit clear of the L1 reth
// (8545/8551/9090) since an OP stack always runs both side by side. Pinned to
// v1.101604.0 — the same op-geth the artifact generator's L2 genesis hash was
// derived from; a different build could compute a different genesis hash and
// op-node would refuse to start.
export const ports: Ports = {
  rpc: 9545,
  ws: 9546,
  authrpc: 9551,
  metrics: { port: 6061, service: false },
  // p2p 30303 is container-internal only (single sequencer, no discovery).
};

function resolvedPorts(def: ContainerDef): Ports {
  return { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
}

export function buildContainer(def: ContainerDef, _ctx: Ctx): ContainerResult {
  const ps = resolvedPorts(def);
  // With an external builder, op-geth must peer with op-rbuilder over L2 P2P so
  // the builder can sync — join the bootnode (geth can't resolve DNS in an enode,
  // so resolve its IP at runtime). Default single-sequencer: no discovery.
  const bootnodeId = def.config?.bootnodeId as string | undefined;
  const discovery = bootnodeId
    ? `--maxpeers 25 --bootnodes enode://${bootnodeId}@$(getent hosts bootnode | awk '{print $1}'):30303 --discovery.v4`
    : "--maxpeers 0 --nodiscover";
  // Set only by recipes/opstack.ts when op-rbuilder runs as a host process: the
  // recipe publishes this EL's p2p port to the host so a deterministic node key
  // is needed.
  const hostBuilderP2p = ps.p2p !== undefined;
  // geth init seeds the datadir from the L2 genesis, then exec's the node.
  const script = [
    "geth init --datadir /data_opgeth --state.scheme hash /artifacts/l2-genesis.json",
    "&& exec geth",
    "--datadir /data_opgeth",
    "--verbosity 3",
    "--http --http.corsdomain '*' --http.vhosts '*' --http.addr 0.0.0.0",
    `--http.port ${portNum(ps.rpc)}`,
    "--http.api web3,debug,eth,txpool,net,engine,miner",
    "--ws --ws.addr 0.0.0.0",
    `--ws.port ${portNum(ps.ws)}`,
    "--ws.origins '*' --ws.api debug,eth,txpool,net,engine,miner",
    `--syncmode full ${discovery}`,
    "--rpc.allow-unprotected-txs",
    "--authrpc.addr 0.0.0.0",
    `--authrpc.port ${portNum(ps.authrpc)}`,
    "--authrpc.vhosts '*' --authrpc.jwtsecret /artifacts/jwtsecret",
    "--gcmode archive --state.scheme hash",
    "--port 30303",
    "--metrics --metrics.addr 0.0.0.0",
    `--metrics.port ${portNum(ps.metrics)}`,
    ...(hostBuilderP2p ? [`--nodekeyhex ${EL_P2P_SECRET_KEY}`] : []),
  ].join(" ");

  return {
    container: {
      image: "us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:v1.101604.0",
      command: ["/bin/sh", "-c", script],
      ports: ps,
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data_opgeth" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
  };
}
