// Build-time version stamp.
//
// Stays "dev" for local `deno run` / `deno install`. The release workflow
// (.github/workflows/release.yml) overwrites this file with the git tag before
// `deno compile`, so released binaries report their actual version.
export const VERSION = "dev";
