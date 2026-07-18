export type Volume = {
  name: string;
  kind: "shared-readonly" | "ephemeral" | "from-shared";
  subPath?: string;
};

export type VolumeMount = {
  name: string;
  mountPath: string;
  subPath?: string;
  readOnly?: boolean;
};

export type PortSpec = number | {
  port: number;
  protocol?: "TCP" | "UDP";
  service?: boolean;
};

export type Ports = Record<string, PortSpec>;

export function portNum(p: PortSpec): number {
  return typeof p === "number" ? p : p.port;
}

export function portProtocol(p: PortSpec): "TCP" | "UDP" | undefined {
  return typeof p === "number" ? undefined : p.protocol;
}

export function portInService(p: PortSpec): boolean {
  return typeof p === "number" ? true : p.service !== false;
}

export type ImageBuildSpec = {
  repo: string;
  ref: string;
  cmd: string;
};

// A host binary built from a git source, the process-side analogue of
// ImageBuildSpec. `cmd` runs in the clone root; `artifact` is the built
// binary's path within the clone (e.g. "target/release/reth-rbuilder").
export type BinaryBuildSpec = {
  repo: string;
  ref: string;
  cmd: string;
  artifact: string;
};

export type ImageEngine = "podman" | "docker";

export type Container = {
  image: string | ImageBuildSpec;
  command?: string[];
  args?: string[];
  env?: Record<string, string>;
  ports?: Ports;
  volumeMounts?: VolumeMount[];
};

export type ConfigFile = {
  filename: string;
  content: string;
  mountPath: string;
};

export type ContainerResult = {
  container: Container;
  volumes?: Volume[];
  configs?: ConfigFile[];
};

export type ProcessAvailability = {
  restart?: "no" | "always" | "on_failure" | "exit_on_failure";
  maxRestarts?: number;
  backoffSeconds?: number;
};

export type ProcessSpec = {
  command: string[];
  env?: Record<string, string>;
  workingDir?: string;
  availability?: ProcessAvailability;
};

export type ProcessResult = {
  process: ProcessSpec;
  configs?: { filename: string; content: string }[];
  // Build this process's binary from source. When set, command[0] must be the
  // path that binaryBuildPath(binaryBuild) resolves to.
  binaryBuild?: BinaryBuildSpec;
};

// A ContainerDef is a recipe-level instance of a prototype placed under a Pod.
// A ProcessDef is a recipe-level instance of a prototype placed under processes.
// Both reference the same Prototype space; the section chooses which build fn fires.
export type ContainerDef = {
  name: string;
  prototype: string | Prototype;
  refs?: Record<string, string>;
  config?: Record<string, unknown>;
};

export type ProcessDef = {
  name: string;
  prototype: string | Prototype;
  refs?: Record<string, string>;
  config?: Record<string, unknown>;
  binary?: string;
};

export type Pod = {
  name: string;
  shareProcessNamespace?: boolean;
  containers: ContainerDef[];
};

export type L1ArtifactsSpec = {
  generator: "l1";
  fork: string;
  blockTimeSeconds?: number;
  genesisDelaySeconds?: number;
};

// OP-stack: an L1 (with the OP system contracts predeployed) plus the L2 genesis
// + rollup config. The L1 consensus fork and the L2 OP fork are chosen
// independently. l1Fork ∈ {electra, fulu}; l2Fork ∈ {isthmus, jovian}.
export type OpstackArtifactsSpec = {
  generator: "opstack";
  l1Fork: string;
  l2Fork: string;
  blockTimeSeconds?: number; // L1 slot time
  l2BlockTimeSeconds?: number; // L2 rollup block time (rollup.json block_time; default 2)
  genesisDelaySeconds?: number;
};

export type ArtifactsSpec = L1ArtifactsSpec | OpstackArtifactsSpec;

export type Script = (recipe: Recipe) => Promise<void> | void;

export type Recipe = {
  artifacts?: ArtifactsSpec;
  artifactsHostPath?: string;
  target?: {
    pods?: string;
    processes?: string;
  };
  pods: Pod[];
  processes?: ProcessDef[];
  scripts?: Script[];
};

export type Ctx = {
  url(name: string, portName: string): string;
  artifactsHostPath: string;
};

export type HostCtx = Ctx & {
  artifactsPath: string;
  dataPath(name: string, volumeName: string): string;
  configPath(name: string, filename: string): string;
  binary(def: ProcessDef, defaultName: string): string;
};

export type PrototypeBuildContainer = (def: ContainerDef, ctx: Ctx) => ContainerResult;
export type PrototypeBuildProcess = (def: ProcessDef, ctx: HostCtx) => ProcessResult;

// A container that exposes a human-facing web UI worth advertising in the `up`
// summary. `port` names which entry in `ports` to link (defaults to "http").
export type WebUi = { label: string; port?: string };

export type Prototype = {
  ports: Ports;
  buildContainer?: PrototypeBuildContainer;
  buildProcess?: PrototypeBuildProcess;
  webui?: WebUi;
};

export type RendererSlot = "pods" | "processes";

export type RenderCtx = {
  manifestRoot: string;
  // An attached sibling run: renderers skip session singletons (dozzle) the
  // primary run already provides.
  attached?: boolean;
};

export type RenderedFile = {
  relPath: string;
  content: string;
};

export type RenderResult = {
  files: RenderedFile[];
  imageBuilds?: Map<string, ImageBuildSpec>;
  binaryBuilds?: Map<string, BinaryBuildSpec>;
  binaries?: string[];
};

export type RendererPaths = {
  runtimeDir: string;
  manifestDir: string;
};

export type Renderer = {
  name: string;
  slot: RendererSlot;
  imageEngine?: ImageEngine;
  hostGateway?: string;
  requiredBinaries?: string[];
  render(recipe: Recipe, ctx: RenderCtx): RenderResult;
  start?(paths: RendererPaths): Promise<number>;
  stop?(runtimeDir: string): Promise<number>;
  summary?(paths: RendererPaths): Array<[string, string]>;
};
