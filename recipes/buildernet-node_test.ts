// The recipe's option surface: what an ALP stackOption or a `--opt` can change
// about the rendered node, and what it must refuse rather than silently ignore.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { recipe } from "./buildernet-node.ts";
import { parseOpts } from "../utils/build.ts";

// the L1 artifacts spec, narrowed: `artifacts` is a union across generators.
function l1(r: ReturnType<typeof recipe>) {
  return r.artifacts as { withdrawals?: string; genesisAccounts?: Record<string, unknown> };
}

function el(r: ReturnType<typeof recipe>) {
  const pod = r.pods.find((p) => p.name === "el-1");
  assert(pod, "the recipe must render an el-1 pod");
  return pod;
}

Deno.test("no options: eth1 withdrawals, both gateways, genesis predeploys", () => {
  const r = recipe();
  assertEquals(l1(r).withdrawals, "eth1");
  assert(Object.keys(l1(r).genesisAccounts ?? {}).length >= 5);
  const names = el(r).containers.map((c) => c.name);
  assert(names.includes("gateway-local"), `el-1 must carry the collocated gateway, got ${names}`);
  assert(r.pods.some((p) => p.name === "bidding-gateway-1"), "the remote gateway pod is missing");
  assert(r.pods.some((p) => p.name === "flowproxy-1"));
  assert(r.pods.some((p) => p.name === "haproxy-1"));
});

Deno.test("withdrawals=none switches the validators to BLS credentials", () => {
  assertEquals(l1(recipe({ withdrawals: "none" })).withdrawals, "none");
});

Deno.test("rbuilder.<key> reaches the builder's config as a raw TOML value", () => {
  const r = recipe({ "rbuilder.live_builders": '["mp-ordering-200ms"]' });
  const cfg = el(r).containers.find((c) => c.name === "el-1")?.config;
  assertEquals((cfg?.rbuilderToml as Record<string, string>)["live_builders"], '["mp-ordering-200ms"]');
});

Deno.test("triePadding takes a count, and a non-numeric one is refused", () => {
  assert(recipe({ triePadding: "64" }).scripts?.length);
  assertThrows(() => recipe({ triePadding: "lots" }), Error, "unknown option");
});

Deno.test("an unknown option is an error, never a silent no-op", () => {
  assertThrows(() => recipe({ nope: "1" }), Error, "unknown option");
  assertThrows(() => recipe({ withdrawals: "sometimes" }), Error, "unknown option");
});

Deno.test("parseOpts: key=value pairs, values may contain '='", () => {
  assertEquals(parseOpts(["withdrawals=none", "rbuilder.x=a=b"]), {
    withdrawals: "none",
    "rbuilder.x": "a=b",
  });
  assertEquals(parseOpts(), {});
  assertThrows(() => parseOpts(["bare"]), Error, "bad --opt");
});
