import { renderClConfig } from "./cl-config.ts";
import { renderElGenesis } from "./el-genesis.ts";
import { renderGenesisSsz } from "./genesis-ssz.ts";
import { loadBlsKeys } from "./bls-keys.ts";
import { writeValidatorKeystores } from "./validator-keystores.ts";
import { allocStateRoot, type GenesisAlloc } from "./state-root.ts";
import { L1_STATE_ROOT } from "./el-block-hash.ts";
import {
  DEFAULT_L1_BLOCK_TIME_SECONDS,
  JWT_SECRET,
  MIN_GENESIS_DELAY_SECONDS,
} from "./constants.ts";

// genesis_validators_root depends only on the validators list, which is
// derived from the (fixed) 100-key BLS fixture. So this hash is constant
// across all runs and we vendor it directly.
const GENESIS_VALIDATORS_ROOT_HEX =
  "9624293efb019b5252a8be86736907ef1cd263cefc17f4e10bcf7e266d42f02d";

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export type GenerateOpts = {
  outDir: string;
  fork: string;
  blockTimeSeconds?: number;
  genesisDelaySeconds?: number;
  // Accounts added on top of the vendored template's — a contract predeployed at
  // a fixed address, an extra funded account. The genesis state root is computed
  // from the result and handed to both the EL genesis and the CL's genesis state,
  // so the two agree either way.
  genesisAccounts?: GenesisAlloc;
};

export type GenerateResult = {
  genesisTimeSeconds: number;
};

export async function generate(opts: GenerateOpts): Promise<GenerateResult> {
  const { fork } = opts;
  const blockTimeSeconds = opts.blockTimeSeconds ?? DEFAULT_L1_BLOCK_TIME_SECONDS;
  const delay = Math.max(opts.genesisDelaySeconds ?? MIN_GENESIS_DELAY_SECONDS, MIN_GENESIS_DELAY_SECONDS);
  const genesisTimeSeconds = Math.floor(Date.now() / 1000) + delay;

  const { outDir } = opts;
  const testnetDir = `${outDir}/testnet`;
  await Deno.mkdir(testnetDir, { recursive: true });

  await Deno.writeTextFile(`${outDir}/jwtsecret`, JWT_SECRET);
  await Deno.writeTextFile(`${testnetDir}/boot_enr.yaml`, "[]");
  await Deno.writeTextFile(`${testnetDir}/deploy_block.txt`, "0");
  await Deno.writeTextFile(`${testnetDir}/deposit_contract_block.txt`, "0");
  await Deno.writeTextFile(`${testnetDir}/genesis_validators_root.txt`, GENESIS_VALIDATORS_ROOT_HEX);

  await Deno.writeTextFile(
    `${testnetDir}/config.yaml`,
    await renderClConfig({ blockTimeSeconds, fork }),
  );

  const el = await renderElGenesis({ genesisTimeSeconds, fork, genesisAccounts: opts.genesisAccounts });
  const elStateRoot = allocStateRoot(el.alloc);
  // Without extra accounts the alloc is exactly the vendored template, whose
  // root is the baked L1_STATE_ROOT — so every run checks the trie code against
  // a known-good value before anything depends on a computed one.
  if (!opts.genesisAccounts && !equalBytes(elStateRoot, L1_STATE_ROOT)) {
    throw new Error("l1 artifacts: computed genesis state root does not match L1_STATE_ROOT");
  }

  await Deno.writeTextFile(`${outDir}/genesis.json`, el.json);
  await Deno.writeFile(
    `${testnetDir}/genesis.ssz`,
    await renderGenesisSsz({ genesisTimeSeconds, fork, elStateRoot }),
  );

  const keys = await loadBlsKeys();
  await writeValidatorKeystores(`${outDir}/data_validator`, keys);

  return { genesisTimeSeconds };
}
