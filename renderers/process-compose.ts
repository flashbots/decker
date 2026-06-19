import { stringify } from "jsr:@std/yaml@^1.0.5";
import { lookup, makeHostCtx } from "../utils/resolve.ts";
import type {
  BinaryBuildSpec,
  ProcessSpec,
  Recipe,
  RenderCtx,
  Renderer,
  RendererPaths,
  RenderResult,
} from "../utils/types.ts";

const yamlOpts = { lineWidth: -1, useAnchors: false, skipInvalid: false } as const;

function build(recipe: Recipe, ctx: RenderCtx): RenderResult {
  const processes = recipe.processes ?? [];
  if (processes.length === 0) return { files: [] };

  if (!recipe.artifactsHostPath) {
    throw new Error("recipe.artifactsHostPath is required for processes");
  }
  const manifestRoot = ctx.manifestRoot;
  const artifactsPath = recipe.artifactsHostPath;
  const dataRoot = `${manifestRoot}/data`;

  const hostCtx = makeHostCtx(
    recipe,
    () => "127.0.0.1",
    artifactsPath,
    (name, volName) => `${dataRoot}/${name}/${volName}`,
    (name, filename) => `${manifestRoot}/configs/${name}/${filename}`,
    (def, defaultName) => def.binary ?? `\${DECKER_ROOT}/bin/${defaultName}`,
  );

  const procs: Record<string, unknown> = {};
  const files: RenderResult["files"] = [];
  const binaries: string[] = [];
  const binaryBuilds = new Map<string, BinaryBuildSpec>();
  for (const def of processes) {
    const proto = lookup(def.prototype);
    if (!proto.buildProcess) {
      throw new Error(`process ${def.name} has no buildProcess()`);
    }
    const built = proto.buildProcess(def, hostCtx);
    const bin = built.process.command[0];
    if (bin) {
      binaries.push(bin);
      if (built.binaryBuild) binaryBuilds.set(bin, built.binaryBuild);
    }
    procs[def.name] = procEntry(built.process);
    for (const cf of built.configs ?? []) {
      files.push({
        relPath: `configs/${def.name}/${cf.filename}`,
        content: cf.content,
      });
    }
  }

  files.push({
    relPath: "process-compose.yaml",
    content: stringify({ version: "0.5", processes: procs }, yamlOpts),
  });

  return { files, binaries, binaryBuilds };
}

async function start(paths: RendererPaths): Promise<number> {
  const yaml = `${paths.runtimeDir}/process-compose.yaml`;
  const { code } = await new Deno.Command("process-compose", {
    args: ["up", "-f", yaml, "--detached"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return code;
}

async function stop(runtimeDir: string): Promise<number> {
  const yaml = `${runtimeDir}/process-compose.yaml`;
  try {
    await Deno.stat(yaml);
  } catch {
    return 0;
  }
  const { code } = await new Deno.Command("process-compose", {
    args: ["down"],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return code;
}

function summary(_paths: RendererPaths): Array<[string, string]> {
  return [["Process logs (process-compose)", "decker attach"]];
}

export const renderer: Renderer = {
  name: "process-compose",
  slot: "processes",
  render: build,
  start,
  stop,
  summary,
};

function procEntry(p: ProcessSpec) {
  const entry: Record<string, unknown> = {
    command: formatCommand(p.command),
  };
  if (p.workingDir) entry.working_dir = p.workingDir;
  if (p.env) {
    entry.environment = Object.entries(p.env).map(([k, v]) => `${k}=${v}`);
  }
  const av = p.availability ?? {};
  entry.availability = {
    restart: av.restart ?? "on_failure",
    max_restarts: av.maxRestarts ?? 5,
    backoff_seconds: av.backoffSeconds ?? 2,
  };
  return entry;
}

function formatCommand(tokens: string[]): string {
  if (tokens.length === 0) return "";
  const quoted = tokens.map(shellQuote);
  const lines: string[] = [];
  let i = 0;
  while (i < quoted.length) {
    const t = quoted[i];
    if (t.startsWith("--") && i + 1 < quoted.length && !quoted[i + 1].startsWith("-")) {
      lines.push(`${t} ${quoted[i + 1]}`);
      i += 2;
    } else {
      lines.push(t);
      i += 1;
    }
  }
  if (lines.length === 1) return lines[0];
  return lines.join(" \\\n  ");
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-+=:,./@]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
