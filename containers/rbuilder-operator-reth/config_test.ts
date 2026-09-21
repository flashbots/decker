// Unit tests for the operator-reth config: the TOML override mechanism a
// recipe option reaches, and the production shape the template must keep.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { applyTomlOverrides, operatorRethConfigFor } from "./config.ts";
import { PRODUCTION_BUILDERS } from "./builders.ts";

const TOML = `builder_name = "node-1"
chain = "/artifacts/genesis.json"

[[builders]]
name = "mp-ordering-25ms"
`;

Deno.test("applyTomlOverrides: an existing top-level key is replaced in place", () => {
  const out = applyTomlOverrides(TOML, { builder_name: '"other"' });
  assertStringIncludes(out, 'builder_name = "other"');
  assert(!out.includes('builder_name = "node-1"'));
  assertEquals(out.split("\n").length, TOML.split("\n").length);
});

Deno.test("applyTomlOverrides: a new key lands ABOVE the first table, not inside it", () => {
  const out = applyTomlOverrides(TOML, { extra_data: '"x"' });
  const lines = out.split("\n");
  assert(lines.indexOf('extra_data = "x"') < lines.indexOf("[[builders]]"));
  assertStringIncludes(out, "# overrides (config.rbuilderToml)");
});

Deno.test("applyTomlOverrides: a key inside a table is not mistaken for a top-level one", () => {
  const out = applyTomlOverrides(TOML, { name: '"zzz"' });
  assertStringIncludes(out, 'name = "mp-ordering-25ms"');
  const lines = out.split("\n");
  assert(lines.indexOf('name = "zzz"') < lines.indexOf("[[builders]]"));
});

Deno.test("applyTomlOverrides: no overrides leaves the config byte-identical", () => {
  assertEquals(applyTomlOverrides(TOML, undefined), TOML);
  assertEquals(applyTomlOverrides(TOML, {}), TOML);
});

Deno.test("operatorRethConfigFor: every production builder and both gateways are rendered", () => {
  const toml = operatorRethConfigFor({
    name: "node-1",
    clUrl: "http://beacon-1:3500",
    gateways: [
      { name: "local", host: "127.0.0.1", port: 6072, apiPort: 6073 },
      { name: "remote", host: "bidding-gateway-1", port: 6072, apiPort: 6073 },
    ],
    ps: { rpc: 8545, ws: 8546, authrpc: 8551, metrics: 9090, jsonrpc: 8645, telemetry: 6060, redacted: 6070, priority: 8745 },
    extraData: "BuilderNet",
  });
  for (const b of PRODUCTION_BUILDERS) assertStringIncludes(toml, `name = "${b.name}"`);
  assertEquals(toml.match(/\[\[builders\]\]/g)?.length, PRODUCTION_BUILDERS.length);
  assertEquals(toml.match(/\[\[bidding_gateways\]\]/g)?.length, 2);
  assertStringIncludes(toml, 'host = "127.0.0.1"');
  assertStringIncludes(toml, 'slot_info_url = "http://bidding-gateway-1:6073"');
  assertStringIncludes(toml, 'extra_data = "BuilderNet"');
});
