import { lookup, makeCtx } from "./resolve.ts";
import { portInService, portNum, portProtocol } from "./types.ts";
import type { ConfigFile, ContainerDef, ContainerResult, Ctx, Pod, Ports, Recipe, Volume, VolumeMount } from "./types.ts";

export type DeployFile = { filename: string; docs: unknown[] };

export function renderDeploy(recipe: Recipe): DeployFile[] {
  const ctx = makeCtx(recipe, (loc) => {
    if (loc.kind === "process") return "host.containers.internal";
    return loc.pod.name;
  });

  const files: DeployFile[] = [{
    filename: "artifacts.yaml",
    docs: [{
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: "decker-artifacts",
        labels: { "app.kubernetes.io/part-of": "decker-l1" },
      },
      spec: {
        accessModes: ["ReadOnlyMany"],
        resources: { requests: { storage: "256Mi" } },
      },
    }],
  }];

  for (const pod of recipe.pods) {
    files.push(podFile(pod, ctx));
  }
  return files;
}

type ContainerBuild = {
  def: ContainerDef;
  built: ContainerResult;
};

function podFile(pod: Pod, ctx: Ctx): DeployFile {
  const labels = {
    "app.kubernetes.io/name": pod.name,
    "app.kubernetes.io/part-of": "decker-l1",
  };
  const matchLabels = { "app.kubernetes.io/name": pod.name };

  const builds: ContainerBuild[] = pod.containers.map((def) => {
    const proto = lookup(def.prototype);
    if (!proto.buildContainer) throw new Error(`container ${def.name} has no buildContainer()`);
    return { def, built: proto.buildContainer(def, ctx) };
  });

  const volMap = new Map<string, Volume>();
  for (const { built } of builds) {
    for (const v of built.volumes ?? []) {
      const existing = volMap.get(v.name);
      if (existing) {
        if (existing.kind !== v.kind || existing.subPath !== v.subPath) {
          throw new Error(`volume ${v.name} kind/subPath mismatch in pod ${pod.name}`);
        }
      } else {
        volMap.set(v.name, v);
      }
    }
  }
  const vols = Array.from(volMap.values());
  const fromShared = vols.filter((v) => v.kind === "from-shared");
  const hasShared = vols.some((v) => v.kind === "shared-readonly" || v.kind === "from-shared");
  const hasData = vols.some((v) => v.kind === "ephemeral") || fromShared.length > 0;

  const allMounts: VolumeMount[] = builds.flatMap((b) => b.built.container.volumeMounts ?? []);

  const configMapDocs: unknown[] = [];
  const configVolumes: unknown[] = [];
  const containers = builds.map(({ def, built }) => {
    const c = built.container;
    const mounts = (c.volumeMounts ?? []).map((m) => rewriteDeployMount(m, volMap));
    const configs = built.configs ?? [];
    const configMountName = `${def.name}-config`;
    for (const cf of configs) {
      mounts.push({
        name: configMountName,
        mountPath: cf.mountPath,
        subPath: cf.filename,
        readOnly: true,
      });
    }
    if (configs.length > 0) {
      configMapDocs.push(configMapDoc(configMountName, configs));
      configVolumes.push({
        name: configMountName,
        configMap: { name: configMountName },
      });
    }
    const ports = expandDeployPorts(c.ports);
    const env = c.env ? Object.entries(c.env).map(([name, value]) => ({ name, value })) : [];
    return {
      name: def.name,
      image: c.image,
      ...(c.command ? { command: c.command } : {}),
      ...(c.args ? { args: c.args } : {}),
      ...(env.length > 0 ? { env } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      volumeMounts: mounts,
    };
  });

  const podSpec: Record<string, unknown> = {};
  if (pod.shareProcessNamespace) podSpec.shareProcessNamespace = true;
  if (fromShared.length > 0) {
    podSpec.initContainers = [buildInitContainer(allMounts, fromShared)];
  }
  podSpec.containers = containers;
  podSpec.volumes = [...buildPodVolumes(hasShared, hasData), ...configVolumes];

  const docs: unknown[] = [
    ...configMapDocs,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: pod.name, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels },
        template: { metadata: { labels: { ...labels } }, spec: podSpec },
      },
    },
  ];

  const servicePorts = collectServicePorts(builds);
  if (servicePorts.length > 0) {
    docs.push({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: pod.name, labels: { ...labels } },
      spec: {
        selector: matchLabels,
        ports: servicePorts,
      },
    });
  }
  return { filename: `${pod.name}.yaml`, docs };
}

function expandDeployPorts(ports: Ports | undefined) {
  if (!ports) return [];
  return Object.entries(ports).map(([name, spec]) => {
    const protocol = portProtocol(spec);
    return {
      name,
      containerPort: portNum(spec),
      ...(protocol ? { protocol } : {}),
    };
  });
}

function collectServicePorts(builds: ContainerBuild[]) {
  const seen = new Set<string>();
  const out: { name: string; port: number; targetPort: string }[] = [];
  for (const { built } of builds) {
    const ports = built.container.ports;
    if (!ports) continue;
    for (const [name, spec] of Object.entries(ports)) {
      if (!portInService(spec)) continue;
      if (seen.has(name)) {
        throw new Error(`duplicate service port name ${name}`);
      }
      seen.add(name);
      out.push({ name, port: portNum(spec), targetPort: name });
    }
  }
  return out;
}

function rewriteDeployMount(m: VolumeMount, vols: Map<string, Volume>) {
  const v = vols.get(m.name);
  if (!v) return m;
  if (v.kind === "shared-readonly") {
    return { name: "artifacts", mountPath: m.mountPath, readOnly: true };
  }
  return { name: "data", mountPath: m.mountPath };
}

function buildInitContainer(mounts: VolumeMount[], fromShared: Volume[]) {
  const cmd = fromShared
    .map((v) => `cp -a /src/${v.subPath}/. ${findMountPath(mounts, v.name)}/`)
    .join(" && ");
  return {
    name: "load-keystores",
    image: "busybox:1.36",
    command: ["sh", "-c", cmd],
    volumeMounts: [
      { name: "artifacts", mountPath: "/src", readOnly: true },
      ...fromShared.map((v) => ({
        name: "data",
        mountPath: findMountPath(mounts, v.name),
      })),
    ],
  };
}

function buildPodVolumes(hasShared: boolean, hasData: boolean) {
  const vols: unknown[] = [];
  if (hasShared) {
    vols.push({
      name: "artifacts",
      persistentVolumeClaim: { claimName: "decker-artifacts", readOnly: true },
    });
  }
  if (hasData) vols.push({ name: "data", emptyDir: {} });
  return vols;
}

function configMapDoc(name: string, configs: ConfigFile[]) {
  const data: Record<string, string> = {};
  for (const cf of configs) {
    if (data[cf.filename] !== undefined) {
      throw new Error(`duplicate config filename ${cf.filename} in ConfigMap ${name}`);
    }
    data[cf.filename] = cf.content;
  }
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name, labels: { "app.kubernetes.io/part-of": "decker-l1" } },
    data,
  };
}

function findMountPath(mounts: VolumeMount[], volName: string): string {
  const m = mounts.find((m) => m.name === volName);
  if (!m) throw new Error(`no mount found for volume ${volName}`);
  return m.mountPath;
}
