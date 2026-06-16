import { assert } from "jsr:@std/assert@^1.0.0";
import { runDecker, withTmp } from "./helpers.ts";

Deno.test("test: fails cleanly against an unreachable RPC", async () => {
  await withTmp(async (cwd) => {
    // Port 1 is closed; bounded timeout so the command can't hang.
    const r = await runDecker(
      ["test", "--rpc", "http://127.0.0.1:1", "--timeout", "3s", "--retries", "1"],
      { cwd },
    );
    assert(r.code !== 0, "should exit non-zero when the RPC is unreachable");
  });
});
