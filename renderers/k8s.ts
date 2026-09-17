import { stringify } from "jsr:@std/yaml@^1.0.5";
import { imageTag } from "../utils/image-build.ts";
import { buildContainerFor, makeCtx } from "../utils/resolve.ts";
import { portInService, portNum, portProtocol } from "../utils/types.ts";
import type {
  ConfigFile,
  ContainerDef,
  ContainerResult,
  Ctx,
  ImageBuildSpec,
  Pod,
  Ports,
  Recipe,
  RenderCtx,
  Renderer,
  RendererPaths,
  RenderResult,
  Volume,
  VolumeMount,
} from "../utils/types.ts";

const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function build(recipe: Recipe, _ctx: RenderCtx): RenderResult {
  const ctx = makeCtx(recipe, (loc) => {
    if (loc.kind === "process") return "host.containers.internal";
    return loc.pod.name;
  });

  const files = [{
    relPath: "deploy/artifacts.yaml",
    content: stringify({
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
    }, yamlOpts),
  }];

  // ImageBuildSpec images are reported back so `up` can build (or, in pull
  // mode, an external builder can supply) them - previously the k8s renderer
  // referenced images nothing built.
  const imageBuilds = new Map<string, ImageBuildSpec>();
  for (const pod of recipe.pods) {
    const docs = podDocs(pod, ctx, imageBuilds);
    const content = docs.map((d) => stringify(d, yamlOpts)).join("---\n");
    files.push({ relPath: `deploy/${pod.name}.yaml`, content });
  }
  return { files, imageBuilds };
}

function summary(paths: RendererPaths): Array<[string, string]> {
  return [["Apply k8s manifests", `kubectl apply -f ${paths.manifestDir}/deploy/`]];
}

export const renderer: Renderer = {
  name: "k8s",
  slot: "pods",
  render: build,
  summary,
};

type ContainerBuild = {
  def: ContainerDef;
  built: ContainerResult;
};

// hasRegistryHost: does the image reference start with a registry host
// (contains "." or ":" in its first path segment, or is "localhost")?
// Local-only tags cannot be pulled by kubelet and must be IfNotPresent.
function hasRegistryHost(image: string): boolean {
  const first = image.split("/")[0];
  return first.includes(".") || first.includes(":") || first === "localhost";
}

function podDocs(pod: Pod, ctx: Ctx, imageBuilds: Map<string, ImageBuildSpec>): unknown[] {
  const labels = {
    "app.kubernetes.io/name": pod.name,
    "app.kubernetes.io/part-of": "decker-l1",
  };
  const matchLabels = { "app.kubernetes.io/name": pod.name };

  const builds: ContainerBuild[] = pod.containers.map((def) => ({ def, built: buildContainerFor(def, ctx) }));

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

  const portNames = podPortNames(builds);

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
    const ports = expandDeployPorts(def.name, c.ports, portNames);
    const env = c.env ? Object.entries(c.env).map(([name, value]) => ({ name, value })) : [];
    // built-from-source images: reference by the canonical build tag (the
    // same one `up`/an external builder produces), registry-prefixed when
    // DECKER_IMAGE_REGISTRY is set. Local-only tags get IfNotPresent so
    // kubelet uses the loaded image instead of trying to pull.
    let image: string;
    let pullPolicy: string | undefined;
    if (typeof c.image === "string") {
      image = c.image;
    } else {
      image = imageTag(c.image);
      imageBuilds.set(image, c.image);
      if (!hasRegistryHost(image)) pullPolicy = "IfNotPresent";
    }
    return {
      name: def.name,
      image,
      ...(pullPolicy ? { imagePullPolicy: pullPolicy } : {}),
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

  const servicePorts = collectServicePorts(builds, portNames);
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
  return docs;
}

// Port names must be unique across the whole pod (k8s validates containerPort
// names pod-wide, and Service targetPort refers to them by name), but decker
// containers freely reuse names like "http" and "metrics". Assign each
// (container, port) a pod-unique name <= 15 chars: the raw name if free, else
// prefixed with as much of the container name as fits.
function podPortNames(builds: ContainerBuild[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const { def, built } of builds) {
    for (const name of Object.keys(built.container.ports ?? {})) {
      let candidate = name;
      if (used.has(candidate)) {
        const room = Math.max(15 - name.length - 1, 1);
        candidate = `${def.name.slice(0, room)}-${name}`.slice(0, 15);
      }
      let i = 0;
      while (used.has(candidate)) candidate = `${candidate.slice(0, 14)}${i++}`;
      used.add(candidate);
      out.set(`${def.name}/${name}`, candidate);
    }
  }
  return out;
}

function expandDeployPorts(defName: string, ports: Ports | undefined, portNames: Map<string, string>) {
  if (!ports) return [];
  return Object.entries(ports).map(([name, spec]) => {
    const protocol = portProtocol(spec);
    return {
      name: portNames.get(`${defName}/${name}`) ?? name,
      containerPort: portNum(spec),
      ...(protocol ? { protocol } : {}),
    };
  });
}

function collectServicePorts(builds: ContainerBuild[], portNames: Map<string, string>) {
  const seen = new Set<number>();
  const out: { name: string; port: number; targetPort: string }[] = [];
  for (const { def, built } of builds) {
    const ports = built.container.ports;
    if (!ports) continue;
    for (const [name, spec] of Object.entries(ports)) {
      if (!portInService(spec)) continue;
      const num = portNum(spec);
      if (seen.has(num)) continue; // same numeric port twice in one pod: first wins
      seen.add(num);
      const unique = portNames.get(`${def.name}/${name}`) ?? name;
      out.push({ name: unique, port: num, targetPort: unique });
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
