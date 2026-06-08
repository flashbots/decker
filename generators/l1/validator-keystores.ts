// Emits the Lighthouse-format validator keystores under data_validator/.
// Layout:
//   data_validator/validators/0x<pubkey>/voting-keystore.json
//   data_validator/secrets/0x<pubkey>
// The BLS fixture already carries pre-encrypted keystore JSON (encrypted
// with KEYSTORE_SECRET), so no crypto runs here.

import { KEYSTORE_SECRET } from "./constants.ts";
import type { BlsKey } from "./bls-keys.ts";

export async function writeValidatorKeystores(rootDir: string, keys: BlsKey[]): Promise<void> {
  const validatorsDir = `${rootDir}/validators`;
  const secretsDir = `${rootDir}/secrets`;
  await Deno.mkdir(validatorsDir, { recursive: true });
  await Deno.mkdir(secretsDir, { recursive: true });
  for (const key of keys) {
    const pubkeyHex = `0x${key.pub}`;
    const keyDir = `${validatorsDir}/${pubkeyHex}`;
    await Deno.mkdir(keyDir, { recursive: true });
    await Deno.writeTextFile(`${keyDir}/voting-keystore.json`, key.keystore);
    await Deno.writeTextFile(`${secretsDir}/${pubkeyHex}`, KEYSTORE_SECRET);
  }
}
