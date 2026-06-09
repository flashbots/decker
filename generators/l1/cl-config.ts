const TEMPLATE_URL = new URL("./cl-config-template.yaml", import.meta.url);

export type ClConfigOpts = {
  blockTimeSeconds: number;
  fork: string;
};

export async function renderClConfig(opts: ClConfigOpts): Promise<string> {
  const raw = await Deno.readTextFile(TEMPLATE_URL);
  const fuluForkEpoch = opts.fork === "fulu" ? "0" : "18446744073709551615";
  return raw
    .replace(/^SECONDS_PER_SLOT:.*$/m, `SECONDS_PER_SLOT: ${opts.blockTimeSeconds}`)
    .replace(/^SLOT_DURATION_MS:.*$/m, `SLOT_DURATION_MS: ${opts.blockTimeSeconds * 1000}`)
    .replace(/^FULU_FORK_EPOCH:.*$/m, `FULU_FORK_EPOCH: ${fuluForkEpoch}`);
}
