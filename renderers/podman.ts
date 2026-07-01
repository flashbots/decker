import { stringify } from "jsr:@std/yaml@^1.0.5";
import { findComponent, lookup, makeCtx } from "../utils/resolve.ts";
import { portNum, portProtocol } from "../utils/types.ts";
import type {
  ConfigFile,
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
import { imageTag } from "../utils/image-build.ts";

export const DOZZLE_PORT = 18080;
const HOST_GATEWAY = "host.containers.internal";

const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function build(recipe: Recipe, renderCtx: RenderCtx): RenderResult {
  const ctx = makeCtx(recipe, (loc) => hostFor(loc));
  const imageBuilds = new Map<string, ImageBuildSpec>();
  const docs: unknown[] = [];
  for (const pod of recipe.pods) {
    const { configMaps, pod: podDoc } = podDocs(pod, recipe, ctx, imageBuilds);
    docs.push(...configMaps, podDoc);
  }
  if (!renderCtx.attached) docs.push(dozzlePod());
  const content = docs.map((d) => stringify(d, yamlOpts)).join("---\n");
  return {
    files: [{ relPath: "podman.yaml", content }],
    imageBuilds,
  };
}

async function start(paths: RendererPaths): Promise<number> {
  const yaml = `${paths.runtimeDir}/podman.yaml`;
  const { code, stdout, stderr } = await new Deno.Command("podman", {
    args: ["kube", "play", yaml],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    await Deno.stdout.write(stdout);
    await Deno.stderr.write(stderr);
  }
  return code;
}

async function stop(runtimeDir: string): Promise<number> {
  const yaml = `${runtimeDir}/podman.yaml`;
  try {
    await Deno.stat(yaml);
  } catch {
    return 0;
  }
  const { code } = await new Deno.Command("podman", {
    args: ["kube", "down", yaml],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return code;
}

function summary(_paths: RendererPaths): Array<[string, string]> {
  return [["Pod logs (Dozzle)", `http://localhost:${DOZZLE_PORT}`]];
}

export const renderer: Renderer = {
  name: "podman",
  slot: "pods",
  imageEngine: "podman",
  hostGateway: HOST_GATEWAY,
  requiredBinaries: ["podman"],
  render: build,
  start,
  stop,
  summary,
};

function hostFor(loc: ReturnType<typeof findComponent>): string {
  if (loc.kind === "process") return HOST_GATEWAY;
  return loc.pod.name;
}

function dozzlePod() {
  const runtime = Deno.env.get("XDG_RUNTIME_DIR") ?? `/run/user/${Deno.uid()}`;
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "dozzle", labels: { app: "dozzle" } },
    spec: {
      restartPolicy: "OnFailure",
      containers: [{
        name: "dozzle",
        image: "docker.io/amir20/dozzle:latest",
        ports: [{ name: "http", containerPort: 8080, hostPort: DOZZLE_PORT }],
        volumeMounts: [{ name: "podman-sock", mountPath: "/var/run/docker.sock" }],
      }],
      volumes: [{
        name: "podman-sock",
        hostPath: { path: `${runtime}/podman/podman.sock`, type: "Socket" },
      }],
    },
  };
}

function podDocs(pod: Pod, recipe: Recipe, ctx: Ctx, imageBuilds: Map<string, ImageBuildSpec>) {
  const containers: unknown[] = [];
  const volsByName = new Map<string, Volume>();
  const configMaps: unknown[] = [];
  const configVolumes: unknown[] = [];
  let hasArtifacts = false;

  for (const def of pod.containers) {
    const proto = lookup(def.prototype);
    if (!proto.buildContainer) throw new Error(`container ${def.name} has no buildContainer()`);
    const built = proto.buildContainer(def, ctx);
    const c = built.container;
    const vols = built.volumes ?? [];
    const volByName = new Map(vols.map((v) => [v.name, v]));

    for (const v of vols) {
      const existing = volsByName.get(v.name);
      if (existing) {
        if (existing.kind !== v.kind || existing.subPath !== v.subPath) {
          throw new Error(`volume ${v.name} kind/subPath mismatch in pod ${pod.name}`);
        }
      } else {
        volsByName.set(v.name, v);
      }
      if (v.kind === "shared-readonly") hasArtifacts = true;
    }

    const podmanMounts = (c.volumeMounts ?? []).map((m) => rewritePodmanMount(m, volByName, pod.name));
    const configMountName = `${def.name}-config`;
    const configs = built.configs ?? [];
    for (const cf of configs) {
      podmanMounts.push({
        name: configMountName,
        mountPath: cf.mountPath,
        subPath: cf.filename,
        readOnly: true,
      });
    }
    if (configs.length > 0) {
      configMaps.push(configMapDoc(configMountName, configs));
      configVolumes.push({
        name: configMountName,
        configMap: { name: configMountName },
      });
    }

    const ports = expandPodmanPorts(c.ports);
    const env = expandEnv(c.env);
    let imageStr: string;
    let pullPolicy: string | undefined;
    if (typeof c.image === "string") {
      imageStr = c.image;
    } else {
      imageStr = imageTag(c.image);
      pullPolicy = "Never";
      const existing = imageBuilds.get(imageStr);
      if (existing) {
        if (existing.repo !== c.image.repo || existing.ref !== c.image.ref || existing.cmd !== c.image.cmd) {
          throw new Error(`image tag ${imageStr} produced by conflicting ImageBuildSpec`);
        }
      } else {
        imageBuilds.set(imageStr, c.image);
      }
    }
    containers.push({
      name: def.name,
      image: imageStr,
      ...(pullPolicy ? { imagePullPolicy: pullPolicy } : {}),
      ...(c.command ? { command: c.command } : {}),
      ...(c.args ? { args: c.args } : {}),
      ...(env.length > 0 ? { env } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      volumeMounts: podmanMounts,
    });
  }

  const podVolumes: unknown[] = [];
  if (hasArtifacts) {
    podVolumes.push({
      name: "artifacts",
      hostPath: { path: recipe.artifactsHostPath, type: "Directory" },
    });
  }
  for (const v of volsByName.values()) {
    if (v.kind === "ephemeral") {
      podVolumes.push({ name: `${pod.name}-${v.name}`, emptyDir: {} });
    }
  }
  podVolumes.push(...configVolumes);

  const spec: Record<string, unknown> = { restartPolicy: "OnFailure" };
  if (pod.shareProcessNamespace) spec.shareProcessNamespace = true;
  spec.containers = containers;
  spec.volumes = podVolumes;

  return {
    configMaps,
    pod: {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: pod.name, labels: { app: pod.name } },
      spec,
    },
  };
}

function configMapDoc(name: string, configs: ConfigFile[]) {
  const data: Record<string, string> = {};
  for (const cf of configs) {
    if (data[cf.filename] !== undefined) {
      throw new Error(`duplicate config filename ${cf.filename} in ConfigMap ${name}`);
    }
    data[cf.filename] = cf.content;
  }
  return { apiVersion: "v1", kind: "ConfigMap", metadata: { name }, data };
}

function expandEnv(env: Record<string, string> | undefined) {
  if (!env) return [];
  return Object.entries(env).map(([name, value]) => ({ name, value }));
}

function expandPodmanPorts(ports: Ports | undefined) {
  if (!ports) return [];
  return Object.entries(ports).map(([name, spec]) => {
    const containerPort = portNum(spec);
    const protocol = portProtocol(spec);
    return {
      name,
      containerPort,
      hostPort: containerPort,
      ...(protocol ? { protocol } : {}),
    };
  });
}

function rewritePodmanMount(m: VolumeMount, vols: Map<string, Volume>, podName: string) {
  const v = vols.get(m.name);
  if (!v) return m;
  if (v.kind === "shared-readonly") {
    return { name: "artifacts", mountPath: m.mountPath, readOnly: true };
  }
  if (v.kind === "ephemeral") {
    return { name: `${podName}-${v.name}`, mountPath: m.mountPath };
  }
  return { name: "artifacts", mountPath: m.mountPath, subPath: v.subPath };
}
