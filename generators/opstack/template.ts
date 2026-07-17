// The genesis/state/rollup templates are the bulk of an OP genesis (mostly
// predeploy bytecode) and compress ~60x, so they're vendored gzipped and
// inflated here at generate-time. Deno's native DecompressionStream keeps this
// dependency-free.
// deno-lint-ignore no-explicit-any
export async function loadGzJson(url: URL): Promise<any> {
  const gz = await Deno.readFile(url);
  const stream = new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
