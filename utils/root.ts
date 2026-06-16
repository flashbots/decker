// Absolute host root for decker's on-disk layout: bin/, cache/, manifests/ and
// runtime/ live here, and it's the bind-mount source baked into emitted
// manifests as `${DECKER_ROOT}/...`, so it must be a real, writable directory.
//
// Normally that's the dir the code lives in — a repo checkout or a `.decker`
// clone. A compiled binary, though, embeds its sources in a read-only virtual
// filesystem (file:///tmp/deno-compile-*/) that can neither hold runtime output
// nor be bind-mounted, so we fall back to the current working directory.
function resolveRoot(): string {
  const override = Deno.env.get("DECKER_ROOT");
  if (override) return override.replace(/\/$/, "");
  const moduleRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  try {
    const probe = `${moduleRoot}/.decker-write-probe`;
    Deno.mkdirSync(probe, { recursive: true });
    Deno.removeSync(probe);
    return moduleRoot;
  } catch {
    return Deno.cwd();
  }
}

export const DECKER_ROOT = resolveRoot();
