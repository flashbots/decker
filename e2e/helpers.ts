import { dirname, fromFileUrl, join } from "jsr:@std/path@^1.0.0";

// Repo root (e2e/ -> ..). Tests invoke the CLI as a black box from here.
export const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

// In CI we point this at the compiled binary so e2e exercises the real artifact
// users get (this is what would have caught the DECKER_ROOT embedded-FS bug).
// Locally, with it unset, we run from source via `deno run`.
const DECKER_BIN = Deno.env.get("DECKER_BIN");

export type RunResult = { code: number; stdout: string; stderr: string; out: string };

export type RunOpts = { cwd?: string; stdin?: string; env?: Record<string, string> };

export async function runDecker(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const env = { NO_COLOR: "1", ...opts.env };
  const base = { cwd: opts.cwd, env, stdin: opts.stdin != null ? "piped" : "null", stdout: "piped", stderr: "piped" } as const;
  const cmd = DECKER_BIN
    ? new Deno.Command(DECKER_BIN, { args, ...base })
    : new Deno.Command("deno", { args: ["run", "-A", join(REPO_ROOT, "cli.ts"), ...args], ...base });

  const child = cmd.spawn();
  if (opts.stdin != null) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(opts.stdin));
    await w.close();
  }
  const { code, stdout, stderr } = await child.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);
  return { code, stdout: out, stderr: err, out: out + err };
}

export function tmpDir(): Promise<string> {
  return Deno.makeTempDir({ prefix: "decker-e2e-" });
}

export async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await tmpDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// A decker.ts manifest pinned at the local checkout, so pull/auto-pull e2e runs
// offline and fast instead of hitting GitHub.
export async function writeLocalManifest(dir: string, recipe = "l1"): Promise<void> {
  const body = `type P = { decker: { source: string; ref: string; into?: string }; recipe: string };
export const project: P = { decker: { source: ${JSON.stringify(REPO_ROOT)}, ref: "main", into: ".decker" }, recipe: ${JSON.stringify(recipe)} };
`;
  await Deno.writeTextFile(join(dir, "decker.ts"), body);
}

// The podman renderer bind-mounts the rootless API socket (for the Dozzle log
// viewer), so a real launch needs the socket service running, not just the
// podman binary. This reports exactly that.
export async function hasPodmanSocket(): Promise<boolean> {
  try {
    const { code, stdout } = await new Deno.Command("podman", {
      args: ["info", "--format", "{{.Host.RemoteSocket.Exists}}"],
      stdout: "piped",
      stderr: "null",
    }).output();
    return code === 0 && new TextDecoder().decode(stdout).trim() === "true";
  } catch {
    return false;
  }
}
