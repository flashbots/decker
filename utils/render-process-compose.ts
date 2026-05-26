import { lookup, makeHostCtx } from "./resolve.ts";
import type { ProcessSpec, Recipe } from "./types.ts";

const DECKER_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

export type ProcessComposeOutput = {
  doc: unknown;
  files: { relPath: string; content: string }[];
  binaries: string[];
};

export function renderProcessCompose(recipe: Recipe, manifestRoot: string): ProcessComposeOutput | null {
  const processes = recipe.processes ?? [];
  if (processes.length === 0) return null;

  if (!recipe.artifactsHostPath) {
    throw new Error("recipe.artifactsHostPath is required for processes");
  }
  const artifactsPath = recipe.artifactsHostPath;
  const dataRoot = `${manifestRoot}/data`;

  const ctx = makeHostCtx(
    recipe,
    () => "127.0.0.1",
    artifactsPath,
    (name, volName) => `${dataRoot}/${name}/${volName}`,
    (name, filename) => `${manifestRoot}/configs/${name}/${filename}`,
    (def, defaultName) => def.binary ?? `\${DECKER_ROOT}/bin/${defaultName}`,
  );

  const procs: Record<string, unknown> = {};
  const files: { relPath: string; content: string }[] = [];
  const binaries: string[] = [];
  for (const def of processes) {
    const proto = lookup(def.prototype);
    if (!proto.buildProcess) {
      throw new Error(`process ${def.name} has no buildProcess()`);
    }
    const built = proto.buildProcess(def, ctx);
    if (built.process.command.length > 0) binaries.push(built.process.command[0]);
    procs[def.name] = procEntry(built.process);
    for (const cf of built.configs ?? []) {
      files.push({
        relPath: `configs/${def.name}/${cf.filename}`,
        content: cf.content,
      });
    }
  }

  return { doc: { version: "0.5", processes: procs }, files, binaries };
}

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
