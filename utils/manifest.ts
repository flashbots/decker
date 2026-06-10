import { isAbsolute, join, toFileUrl } from "jsr:@std/path@^1.0.0";
import { done, fail, step } from "./term.ts";

export type DeckerProject = {
  decker: {
    source: string;
    commit: string;
    into?: string;
  };
  recipe: string;
};

export type Manifest = {
  path: string;
  project: DeckerProject;
};

export const DEFAULT_MANIFEST = "decker.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadManifest(path: string): Promise<Manifest> {
  const abs = isAbsolute(path) ? path : join(Deno.cwd(), path);
  if (!await exists(abs)) {
    throw new Error(`manifest not found: ${path}`);
  }
  const real = await Deno.realPath(abs);
  const mod = await import(toFileUrl(real).href);
  if (!mod.project) {
    throw new Error(`${path} must export 'project: DeckerProject'`);
  }
  return { path: real, project: mod.project };
}

export function intoDir(p: DeckerProject): string {
  const into = p.decker.into ?? ".decker";
  return isAbsolute(into) ? into : join(Deno.cwd(), into);
}

export async function isCloned(p: DeckerProject): Promise<boolean> {
  return await exists(join(intoDir(p), "cli.ts"));
}

async function head(dir: string): Promise<string> {
  const { code, stdout } = await new Deno.Command("git", {
    args: ["-C", dir, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`git rev-parse failed in ${dir}`);
  return new TextDecoder().decode(stdout).trim();
}

async function isDirty(dir: string): Promise<boolean> {
  const { code, stdout } = await new Deno.Command("git", {
    args: ["-C", dir, "status", "--porcelain"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`git status failed in ${dir}`);
  return new TextDecoder().decode(stdout).trim().length > 0;
}

async function checkout(dir: string, commit: string): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args: ["-C", dir, "checkout", "--quiet", commit],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    await Deno.stderr.write(stderr);
    throw new Error(`git checkout ${commit} failed`);
  }
}

async function fetchAll(dir: string): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args: ["-C", dir, "fetch", "--quiet", "--all", "--tags"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    await Deno.stderr.write(stderr);
    throw new Error("git fetch failed");
  }
}

export async function pull(p: DeckerProject): Promise<string> {
  const src = p.decker.source;
  const commit = p.decker.commit;
  if (!src) throw new Error("decker.source required");
  if (!commit) throw new Error("decker.commit required");
  const dst = intoDir(p);

  if (!await isCloned(p)) {
    const sp = step(`cloning ${src}`);
    const { code, stderr } = await new Deno.Command("git", {
      args: ["clone", "--quiet", src, dst],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (code !== 0) {
      fail(sp, "git clone failed");
      await Deno.stderr.write(stderr);
      throw new Error("clone failed");
    }
    done(sp, dst);
    const spC = step(`checking out ${commit.slice(0, 12)}`);
    try {
      await checkout(dst, commit);
    } catch (e) {
      fail(spC, (e as Error).message);
      throw e;
    }
    done(spC);
  } else {
    if (await head(dst) === commit) return dst;
    if (await isDirty(dst)) {
      throw new Error(`${dst} has uncommitted changes; refusing to checkout ${commit.slice(0, 12)}`);
    }
    const spF = step(`fetching in ${dst}`);
    try {
      await fetchAll(dst);
    } catch (e) {
      fail(spF, (e as Error).message);
      throw e;
    }
    done(spF);
    const spC = step(`checking out ${commit.slice(0, 12)}`);
    try {
      await checkout(dst, commit);
    } catch (e) {
      fail(spC, (e as Error).message);
      throw e;
    }
    done(spC);
  }

  const got = await head(dst);
  if (got !== commit) {
    throw new Error(`HEAD ${got.slice(0, 12)} != commit ${commit.slice(0, 12)}`);
  }
  return dst;
}

export async function ensureClone(p: DeckerProject): Promise<string> {
  const dst = intoDir(p);
  if (!await isCloned(p)) {
    throw new Error(`${dst} not present — run \`decker pull\` first`);
  }
  const got = await head(dst);
  if (got !== p.decker.commit) {
    throw new Error(
      `${dst} at ${got.slice(0, 12)} but manifest pins ${p.decker.commit.slice(0, 12)} — run \`decker pull\``,
    );
  }
  return dst;
}
