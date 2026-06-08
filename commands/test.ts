import { Command } from "jsr:@cliffy/command@^1.0.0-rc.7";
import { bold, dim, green, ms, red } from "../utils/term.ts";

const RPC_URL = "http://localhost:8545";
const TARGET_BLOCK = 1;
const TIMEOUT_MS = 60_000;
const POLL_MS = 500;

async function blockNumber(url: string): Promise<number> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const json = await res.json();
  return parseInt(json.result, 16);
}

export const command = new Command()
  .description(`Verify the running stack reaches block ${TARGET_BLOCK} on ${RPC_URL}`)
  .action(async () => {
    const t0 = performance.now();
    const deadline = t0 + TIMEOUT_MS;
    while (performance.now() < deadline) {
      try {
        const n = await blockNumber(RPC_URL);
        if (n >= TARGET_BLOCK) {
          console.log(`${green("✓")} EL produced block ${bold(String(n))} ${dim(`(${ms(t0)})`)}`);
          Deno.exit(0);
        }
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    console.error(red(`✗ EL didn't reach block ${TARGET_BLOCK} within ${TIMEOUT_MS / 1000}s`));
    Deno.exit(1);
  });
