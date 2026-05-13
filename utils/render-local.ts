import { findContainer, lookup, makeCtx } from "./resolve.ts";
import { portNum, portProtocol } from "./types.ts";
import type { ConfigFile, Ctx, Pod, Ports, Recipe, Volume, VolumeMount } from "./types.ts";

export const DOZZLE_PORT = 18080;

export function renderLocal(recipe: Recipe): unknown[] {
  const ctx = makeCtx(recipe, (name) => findContainer(recipe, name).pod.name);
  const docs: unknown[] = [];
  for (const pod of recipe.pods) {
    const { configMaps, pod: podDoc } = podDocs(pod, recipe, ctx);
    docs.push(...configMaps, podDoc);
  }
  docs.push(dozzlePod());
  return docs;
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

function podDocs(pod: Pod, recipe: Recipe, ctx: Ctx) {
  const containers: unknown[] = [];
  const volsByName = new Map<string, Volume>();
  const configMaps: unknown[] = [];
  const configVolumes: unknown[] = [];
  let hasArtifacts = false;

  for (const def of pod.containers) {
    const built = lookup(def.prototype).build(def, ctx);
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

    const localMounts = (c.volumeMounts ?? []).map((m) => rewriteLocalMount(m, volByName));
    const configMountName = `${def.name}-config`;
    const configs = built.configs ?? [];
    for (const cf of configs) {
      localMounts.push({
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

    const ports = expandLocalPorts(c.ports);
    const env = expandEnv(c.env);
    containers.push({
      name: def.name,
      image: c.image,
      ...(c.command ? { command: c.command } : {}),
      ...(c.args ? { args: c.args } : {}),
      ...(env.length > 0 ? { env } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      volumeMounts: localMounts,
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
      podVolumes.push({ name: v.name, emptyDir: {} });
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

function expandLocalPorts(ports: Ports | undefined) {
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

function rewriteLocalMount(m: VolumeMount, vols: Map<string, Volume>) {
  const v = vols.get(m.name);
  if (!v) return m;
  if (v.kind === "shared-readonly") {
    return { name: "artifacts", mountPath: m.mountPath, readOnly: true };
  }
  if (v.kind === "ephemeral") {
    return { name: v.name, mountPath: m.mountPath };
  }
  return { name: "artifacts", mountPath: m.mountPath, subPath: v.subPath };
}
