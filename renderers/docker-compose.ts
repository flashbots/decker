import { stringify } from "jsr:@std/yaml@^1.0.5";
import { lookup, makeCtx } from "../utils/resolve.ts";
import { portNum, portProtocol } from "../utils/types.ts";
import type {
  Ctx,
  ImageBuildSpec,
  Pod,
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

const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function build(recipe: Recipe, _ctx: RenderCtx): RenderResult {
  const ctx = makeCtx(recipe, (loc) => {
    if (loc.kind === "process") return "host.docker.internal";
    return loc.pod.name;
  });
  const imageBuilds = new Map<string, ImageBuildSpec>();
  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = {};
  const files: RenderResult["files"] = [];

  for (const pod of recipe.pods) {
    addPod(pod, recipe, ctx, imageBuilds, services, volumes, files);
  }

  services["dozzle"] = {
    image: "docker.io/amir20/dozzle:latest",
    container_name: "dozzle",
    restart: "on-failure",
    ports: [`${DOZZLE_PORT}:8080`],
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
  };

  const doc: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) doc.volumes = volumes;
  files.unshift({ relPath: "docker-compose.yaml", content: stringify(doc, yamlOpts) });
  return { files, imageBuilds };
}

async function start(paths: RendererPaths): Promise<number> {
  const yaml = `${paths.runtimeDir}/docker-compose.yaml`;
  const existing = await new Deno.Command("docker", {
    args: ["compose", "-f", yaml, "ps", "-q"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (existing.code === 0 && new TextDecoder().decode(existing.stdout).trim().length > 0) {
    await Deno.stderr.write(new TextEncoder().encode(
      "docker-compose stack already up — run `decker down` first\n",
    ));
    return 1;
  }
  const { code, stdout, stderr } = await new Deno.Command("docker", {
    args: ["compose", "-f", yaml, "up", "-d", "--remove-orphans"],
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
  const yaml = `${runtimeDir}/docker-compose.yaml`;
  try {
    await Deno.stat(yaml);
  } catch {
    return 0;
  }
  const { code } = await new Deno.Command("docker", {
    args: ["compose", "-f", yaml, "down", "-v"],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (code !== 0) return code;
  // Containers may have written root-owned files into the bind-mounted artifacts
  // dir; clean them up so the next `up`'s host-side regen can wipe the dir.
  const artifacts = `${runtimeDir}/artifacts`;
  try {
    await Deno.stat(artifacts);
  } catch {
    return 0;
  }
  const clean = await new Deno.Command("docker", {
    args: ["run", "--rm", "-v", `${artifacts}:/a`, "alpine", "sh", "-c", "rm -rf /a/* /a/.[!.]* 2>/dev/null; true"],
    stdout: "null",
    stderr: "inherit",
  }).output();
  return clean.code;
}

function summary(_paths: RendererPaths): Array<[string, string]> {
  return [["Container logs (Dozzle)", `http://localhost:${DOZZLE_PORT}`]];
}

export const renderer: Renderer = {
  name: "docker-compose",
  slot: "pods",
  imageEngine: "docker",
  render: build,
  start,
  stop,
  summary,
};

function addPod(
  pod: Pod,
  recipe: Recipe,
  ctx: Ctx,
  imageBuilds: Map<string, ImageBuildSpec>,
  services: Record<string, unknown>,
  volumes: Record<string, unknown>,
  files: RenderResult["files"],
) {
  const builds = pod.containers.map((def) => {
    const proto = lookup(def.prototype);
    if (!proto.buildContainer) throw new Error(`container ${def.name} has no buildContainer()`);
    return { def, built: proto.buildContainer(def, ctx) };
  });
  const leader = builds[0];

  const podVols = new Map<string, Volume>();
  for (const { built } of builds) {
    for (const v of built.volumes ?? []) {
      const existing = podVols.get(v.name);
      if (existing) {
        if (existing.kind !== v.kind || existing.subPath !== v.subPath) {
          throw new Error(`volume ${v.name} kind/subPath mismatch in pod ${pod.name}`);
        }
      } else {
        podVols.set(v.name, v);
      }
    }
  }
  for (const v of podVols.values()) {
    if (v.kind === "ephemeral") {
      volumes[`${pod.name}-${v.name}`] = {};
    }
  }

  const allPorts: string[] = [];
  const seenPorts = new Set<string>();
  for (const { built } of builds) {
    for (const [, spec] of Object.entries(built.container.ports ?? {})) {
      const p = portNum(spec);
      const proto = portProtocol(spec);
      const protoSuffix = proto && proto.toUpperCase() === "UDP" ? "/udp" : "";
      const entry = `${p}:${p}${protoSuffix}`;
      if (seenPorts.has(entry)) continue;
      seenPorts.add(entry);
      allPorts.push(entry);
    }
  }

  const aliases: string[] = [];
  for (const { def } of builds) {
    if (def.name !== leader.def.name) aliases.push(def.name);
  }
  if (pod.name !== leader.def.name && !aliases.includes(pod.name)) {
    aliases.push(pod.name);
  }

  for (const { def, built } of builds) {
    const c = built.container;
    const isLeader = def.name === leader.def.name;

    let imageStr: string;
    if (typeof c.image === "string") {
      imageStr = c.image;
    } else {
      imageStr = imageTag(c.image);
      const existing = imageBuilds.get(imageStr);
      if (existing) {
        if (existing.repo !== c.image.repo || existing.ref !== c.image.ref || existing.cmd !== c.image.cmd) {
          throw new Error(`image tag ${imageStr} produced by conflicting ImageBuildSpec`);
        }
      } else {
        imageBuilds.set(imageStr, c.image);
      }
    }

    const svcVols: string[] = [];
    for (const m of c.volumeMounts ?? []) {
      const v = podVols.get(m.name);
      if (!v) throw new Error(`mount ${m.name} on ${def.name} has no matching volume`);
      svcVols.push(formatMount(m, v, pod.name, recipe));
    }
    for (const cf of built.configs ?? []) {
      const hostPath = `\${DECKER_ROOT}/runtime/configs/${def.name}/${cf.filename}`;
      svcVols.push(`${hostPath}:${cf.mountPath}:ro`);
      files.push({ relPath: `configs/${def.name}/${cf.filename}`, content: cf.content });
    }

    const svc: Record<string, unknown> = {
      image: imageStr,
      container_name: def.name,
      restart: "on-failure",
    };
    if (c.command) svc.entrypoint = c.command;
    if (c.args) svc.command = c.args;
    if (c.env) svc.environment = c.env;
    if (svcVols.length > 0) svc.volumes = svcVols;

    if (isLeader) {
      if (allPorts.length > 0) svc.ports = allPorts;
      if (aliases.length > 0) svc.networks = { default: { aliases } };
    } else {
      svc.network_mode = `service:${leader.def.name}`;
      if (pod.shareProcessNamespace) svc.pid = `service:${leader.def.name}`;
      svc.depends_on = [leader.def.name];
    }

    services[def.name] = svc;
  }
}

function formatMount(m: VolumeMount, v: Volume, podName: string, recipe: Recipe): string {
  if (v.kind === "shared-readonly") {
    return `${recipe.artifactsHostPath}:${m.mountPath}:ro`;
  }
  if (v.kind === "ephemeral") {
    return `${podName}-${v.name}:${m.mountPath}`;
  }
  const sub = v.subPath ? `/${v.subPath}` : "";
  return `${recipe.artifactsHostPath}${sub}:${m.mountPath}`;
}
