// Loads the pregenerated 100-key BLS fixture. The fixture's keystore field is
// pre-encrypted with KEYSTORE_SECRET so we can write it to disk without any
// crypto in TS.

const FIXTURE_URL = new URL("./bls_keys.json", import.meta.url);

export type BlsKey = {
  priv: string;
  pub: string;
  keystore: string;
};

let cached: BlsKey[] | null = null;

export async function loadBlsKeys(): Promise<BlsKey[]> {
  if (cached) return cached;
  const raw = await Deno.readTextFile(FIXTURE_URL);
  cached = JSON.parse(raw) as BlsKey[];
  return cached;
}
