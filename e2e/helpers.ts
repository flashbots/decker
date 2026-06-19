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

// Ref to pin in test manifests. CI isn't always on `main` (feature-branch and
// detached-HEAD PR builds are common), so resolve REPO_ROOT's real state: its
// branch if checked out on one, else the HEAD commit. Both resolve in the clone
// — a branch via origin/<branch>, a SHA directly (a local-path clone copies the
// full object store, so even a detached commit is present).
async function repoRef(): Promise<string> {
  const git = async (...args: string[]): Promise<string> => {
    const { code, stdout } = await new Deno.Command("git", {
      args: ["-C", REPO_ROOT, ...args],
      stdout: "piped",
      stderr: "null",
    }).output();
    return code === 0 ? new TextDecoder().decode(stdout).trim() : "";
  };
  return (await git("branch", "--show-current")) || (await git("rev-parse", "HEAD")) || "main";
}

// A decker.ts manifest pinned at the local checkout, so pull/auto-pull e2e runs
// offline and fast instead of hitting GitHub.
export async function writeLocalManifest(dir: string, recipe = "l1"): Promise<void> {
  const ref = await repoRef();
  const body = `type P = { decker: { source: string; ref: string; into?: string }; recipe: string };
export const project: P = { decker: { source: ${JSON.stringify(REPO_ROOT)}, ref: ${JSON.stringify(ref)}, into: ".decker" }, recipe: ${JSON.stringify(recipe)} };
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
