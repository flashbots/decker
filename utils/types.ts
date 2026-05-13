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

export type Container = {
  image: string;
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

export type BuildResult = {
  container: Container;
  volumes?: Volume[];
  configs?: ConfigFile[];
};

export type ContainerDef = {
  name: string;
  prototype: string | Prototype;
  refs?: Record<string, string>;
  config?: Record<string, unknown>;
};

export type Pod = {
  name: string;
  shareProcessNamespace?: boolean;
  containers: ContainerDef[];
};

export type Recipe = {
  artifacts: string;
  artifactsHostPath?: string;
  pods: Pod[];
};

export type Ctx = {
  url(containerName: string, portName: string): string;
};

export type PrototypeBuild = (def: ContainerDef, ctx: Ctx) => BuildResult;

export type Prototype = {
  ports: Ports;
  build: PrototypeBuild;
};
