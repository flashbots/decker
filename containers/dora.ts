import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

const HTTP_PORT = 8080;

export const ports: Ports = { http: HTTP_PORT };

// Surfaced in the `decker up` summary, after the Dozzle line.
export const webui = { label: "Consensus explorer (Dora)" };

// Dora (ethpandaops) — the beacon-chain / consensus-layer explorer shipped by the
// Kurtosis ethereum-package. It connects server-side: the beacon is a sibling
// container (reached by pod DNS), the EL is the host reth-rbuilder process
// (reached via the host gateway). The EL genesis is read from the shared
// artifacts mount. Config schema mirrors the package's dora-config template.
export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  const el = def.refs?.el;
  if (!beacon) throw new Error(`dora ${def.name}: missing refs.beacon`);
  if (!el) throw new Error(`dora ${def.name}: missing refs.el`);
  const port = portNum((def.config?.ports as Ports | undefined)?.http ?? ports.http);

  const config = `logging:
  outputLevel: "info"
chain:
  displayName: "decker"
server:
  host: "0.0.0.0"
  port: "${port}"
frontend:
  enabled: true
  siteName: "Dora the Explorer"
  siteSubtitle: "decker"
  showSensitivePeerInfos: true
api:
  enabled: true
  corsOrigins:
    - "*"
beaconapi:
  endpoints:
    - url: "${ctx.url(beacon, "http")}"
      name: "${beacon}"
      archive: true
  localCacheSize: 10
executionapi:
  genesisConfig: "/artifacts/genesis.json"
  endpoints:
    - url: "${ctx.url(el, "rpc")}"
      name: "${el}"
      archive: true
  depositLogBatchSize: 1000
indexer:
  inMemoryEpochs: 8
  syncEpochCooldown: 1
executionIndexer:
  enabled: false
database:
  engine: "sqlite"
  sqlite:
    file: "/data/dora.sqlite"
blockDb:
  engine: "pebble"
  pebble:
    path: "/data/dora-blockdb.peb"
    cacheSize: 100
`;

  return {
    container: {
      image: "docker.io/ethpandaops/dora:latest",
      args: ["-config", "/config/dora-config.yaml"],
      ports: { http: port },
      volumeMounts: [
        { name: "artifacts", mountPath: "/artifacts", readOnly: true },
        { name: "data",      mountPath: "/data" },
      ],
    },
    volumes: [
      { name: "artifacts", kind: "shared-readonly" },
      { name: "data",      kind: "ephemeral" },
    ],
    configs: [
      { filename: "dora-config.yaml", content: config, mountPath: "/config/dora-config.yaml" },
    ],
  };
}
