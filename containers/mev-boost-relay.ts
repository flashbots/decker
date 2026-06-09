import type { Container, ContainerDef, ContainerResult, Ctx, ImageBuildSpec } from "../utils/types.ts";

const IMAGE: ImageBuildSpec = {
  repo: "https://github.com/flashbots/mev-boost-relay",
  ref: "caner/devnet-cold-starts",
  cmd: "podman build -t $IMAGE .",
};
const BLS_KEYS_FIXTURE = new URL("../generators/l1/bls_keys.json", import.meta.url);
const DEFAULT_API_PORT = 9062;
const DEFAULT_SECRET_KEY = "0x5eae315483f028b5cdd5d1090ff0c7618b18737ea9bf3c35047189db22835c48";

export const ports = {
  http: DEFAULT_API_PORT,
};

type SharedRefs = {
  beacon: string;
  postgres: string;
  redis: string;
};

type Common = {
  beaconUri: string;
  db: string;
  redisUri: string;
  forkEnv: Record<string, string>;
  pgHostPort: string;
  redisHostPort: string;
};

function resolveRefs(def: ContainerDef): SharedRefs {
  const beacon = def.refs?.beacon;
  const postgres = def.refs?.postgres;
  const redis = def.refs?.redis;
  if (!beacon) throw new Error(`mev-boost-relay ${def.name}: missing refs.beacon`);
  if (!postgres) throw new Error(`mev-boost-relay ${def.name}: missing refs.postgres`);
  if (!redis) throw new Error(`mev-boost-relay ${def.name}: missing refs.redis`);
  return { beacon, postgres, redis };
}

function hostPort(ctx: Ctx, name: string, portName: string): string {
  return new URL(ctx.url(name, portName)).host;
}

function readForkEnv(artifactsHostPath: string): Record<string, string> {
  const text = Deno.readTextFileSync(`${artifactsHostPath}/testnet/config.yaml`);
  const grep = (key: string): string => {
    const m = text.match(new RegExp(`^${key}:\\s*(0x[0-9a-fA-F]+)`, "m"));
    if (!m) throw new Error(`mev-boost-relay: ${key} missing from config.yaml`);
    return m[1];
  };
  const validatorsRoot = Deno.readTextFileSync(
    `${artifactsHostPath}/testnet/genesis_validators_root.txt`,
  ).trim();
  return {
    GENESIS_FORK_VERSION:    grep("GENESIS_FORK_VERSION"),
    GENESIS_VALIDATORS_ROOT: "0x" + validatorsRoot,
    BELLATRIX_FORK_VERSION:  grep("BELLATRIX_FORK_VERSION"),
    CAPELLA_FORK_VERSION:    grep("CAPELLA_FORK_VERSION"),
    DENEB_FORK_VERSION:      grep("DENEB_FORK_VERSION"),
    ELECTRA_FORK_VERSION:    grep("ELECTRA_FORK_VERSION"),
    FULU_FORK_VERSION:       grep("FULU_FORK_VERSION"),
  };
}

function common(def: ContainerDef, ctx: Ctx): Common & { refs: SharedRefs } {
  const refs = resolveRefs(def);
  const password = (def.config?.postgresPassword as string | undefined) ?? "decker";
  const pgHostPort = hostPort(ctx, refs.postgres, "postgres");
  const redisHostPort = hostPort(ctx, refs.redis, "redis");
  return {
    refs,
    beaconUri: ctx.url(refs.beacon, "http"),
    db: `postgres://postgres:${password}@${pgHostPort}/postgres?sslmode=disable`,
    redisUri: `redis://${redisHostPort}`,
    forkEnv: readForkEnv(ctx.artifactsHostPath),
    pgHostPort,
    redisHostPort,
  };
}

function waitExecScript(pgHostPort: string, redisHostPort: string, binArgs: string[]): string {
  const pgPort = pgHostPort.split(":")[1];
  const redisPort = redisHostPort.split(":")[1];
  const escaped = binArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  return [
    `until nc -z localhost ${pgPort}; do sleep 0.5; done`,
    `until nc -z localhost ${redisPort}; do sleep 0.5; done`,
    `exec /app/mev-boost-relay ${escaped}`,
  ].join("\n");
}

function shellContainer(env: Record<string, string>, script: string, exposedPorts?: Container["ports"]): Container {
  return {
    image: IMAGE,
    command: ["/bin/sh", "-c"],
    args: [script],
    env,
    ...(exposedPorts ? { ports: exposedPorts } : {}),
  };
}

function knownValidatorsCSV(): string {
  const raw = Deno.readTextFileSync(BLS_KEYS_FIXTURE);
  const keys = JSON.parse(raw) as Array<{ pub: string }>;
  return keys.map((k) => "0x" + k.pub.replace(/^0x/, "")).join(",");
}

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const c = common(def, ctx);
  const apiPort = (def.config?.port as number | undefined) ?? DEFAULT_API_PORT;
  const secretKey = (def.config?.secretKey as string | undefined) ?? DEFAULT_SECRET_KEY;
  const args = [
    "api",
    "--network", "custom",
    "--listen-addr", `0.0.0.0:${apiPort}`,
    "--beacon-uris", c.beaconUri,
    "--db", c.db,
    "--redis-uri", c.redisUri,
    "--blocksim", ctx.url(def.refs?.el ?? "", "rpc"),
    "--secret-key", secretKey,
    "--known-validators", knownValidatorsCSV(),
    "--internal-api",
  ];
  return {
    container: shellContainer(
      { ...c.forkEnv, ENABLE_BUILDER_CANCELLATIONS: "1", ALLOW_SYNCING_BEACON_NODE: "1" },
      waitExecScript(c.pgHostPort, c.redisHostPort, args),
      { http: apiPort },
    ),
  };
}

export function buildHousekeeperContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const c = common(def, ctx);
  const args = [
    "housekeeper",
    "--network", "custom",
    "--beacon-uris", c.beaconUri,
    "--db", c.db,
    "--redis-uri", c.redisUri,
  ];
  return {
    container: shellContainer(c.forkEnv, waitExecScript(c.pgHostPort, c.redisHostPort, args)),
  };
}
