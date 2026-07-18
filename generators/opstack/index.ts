import { renderClConfig } from "../l1/cl-config.ts";
import { renderGenesisSsz } from "../l1/genesis-ssz.ts";
import { computeElGenesisHash } from "../l1/el-block-hash.ts";
import { loadBlsKeys } from "../l1/bls-keys.ts";
import { writeValidatorKeystores } from "../l1/validator-keystores.ts";
import {
  DEFAULT_L1_BLOCK_TIME_SECONDS,
  JWT_SECRET,
  MIN_GENESIS_DELAY_SECONDS,
} from "../l1/constants.ts";
import { renderL1Genesis } from "./l1-genesis.ts";
import { renderL2Genesis } from "./l2-genesis.ts";
import { renderRollup } from "./rollup.ts";
import { computeOpGenesisHash } from "./op-block-hash.ts";
import { OP_TIMESTAMP_OFFSET_SECONDS } from "./constants.ts";
import { L1_FORKS, L2_FORKS } from "./forks.ts";

// genesis_validators_root is a Merkle root over the (fixed) 100-key validator
// list, so it's constant across runs — same fixture as the l1 generator.
const GENESIS_VALIDATORS_ROOT_HEX =
  "9624293efb019b5252a8be86736907ef1cd263cefc17f4e10bcf7e266d42f02d";

export type GenerateOpts = {
  outDir: string;
  // L1 consensus fork ("electra" | "fulu"). Defaults to "electra".
  l1Fork?: string;
  // L2 OP fork ("isthmus" | "jovian"). Defaults to "isthmus".
  l2Fork?: string;
  blockTimeSeconds?: number; // L1 slot time
  l2BlockTimeSeconds?: number; // L2 rollup block time (rollup.json block_time; default 2)
  genesisDelaySeconds?: number;
  // Test-only: pin the genesis time so the output is byte-reproducible against a
  // reference builder-playground run. Production leaves it unset.
  genesisTimeSeconds?: number;
};

export type GenerateResult = {
  genesisTimeSeconds: number;
};

export async function generate(opts: GenerateOpts): Promise<GenerateResult> {
  const l1Fork = opts.l1Fork ?? "electra";
  const l2Fork = opts.l2Fork ?? "isthmus";

  if (!(L1_FORKS as readonly string[]).includes(l1Fork)) {
    throw new Error(`opstack: unsupported l1Fork "${l1Fork}" (supported: ${L1_FORKS.join(", ")})`);
  }
  const fork = L2_FORKS[l2Fork];
  if (!fork) {
    throw new Error(
      `opstack: unsupported l2Fork "${l2Fork}" (supported: ${Object.keys(L2_FORKS).join(", ")}). ` +
        `Newer forks need their templates + constants vendored first — see generators/opstack/AGENTS.md.`,
    );
  }

  const blockTimeSeconds = opts.blockTimeSeconds ?? DEFAULT_L1_BLOCK_TIME_SECONDS;
  const delay = Math.max(opts.genesisDelaySeconds ?? MIN_GENESIS_DELAY_SECONDS, MIN_GENESIS_DELAY_SECONDS);
  const genesisTimeSeconds = opts.genesisTimeSeconds ?? Math.floor(Date.now() / 1000) + delay;
  const opTimestampSeconds = genesisTimeSeconds + OP_TIMESTAMP_OFFSET_SECONDS;

  const { outDir } = opts;
  const testnetDir = `${outDir}/testnet`;
  await Deno.mkdir(testnetDir, { recursive: true });

  // --- L1 CL/EL artifacts ---
  await Deno.writeTextFile(`${outDir}/jwtsecret`, JWT_SECRET);
  await Deno.writeTextFile(`${testnetDir}/boot_enr.yaml`, "[]");
  await Deno.writeTextFile(`${testnetDir}/deploy_block.txt`, "0");
  await Deno.writeTextFile(`${testnetDir}/deposit_contract_block.txt`, "0");
  await Deno.writeTextFile(`${testnetDir}/genesis_validators_root.txt`, GENESIS_VALIDATORS_ROOT_HEX);

  await Deno.writeTextFile(
    `${testnetDir}/config.yaml`,
    await renderClConfig({ blockTimeSeconds, fork: l1Fork }),
  );

  await Deno.writeTextFile(
    `${outDir}/genesis.json`,
    await renderL1Genesis(fork.l1GenesisTemplate, genesisTimeSeconds, l1Fork),
  );
  await Deno.writeFile(
    `${testnetDir}/genesis.ssz`,
    await renderGenesisSsz({
      genesisTimeSeconds,
      fork: l1Fork,
      elStateRoot: fork.l1StateRoot,
    }),
  );

  const keys = await loadBlsKeys();
  await writeValidatorKeystores(`${outDir}/data_validator`, keys);

  // --- L2 artifacts ---
  const l1Hash = computeElGenesisHash(genesisTimeSeconds, fork.l1StateRoot);
  const l2Hash = computeOpGenesisHash(opTimestampSeconds, {
    stateRoot: fork.l2StateRoot,
    withdrawalsRoot: fork.l2WithdrawalsRoot,
    extraData: fork.l2ExtraData,
  });

  await Deno.writeTextFile(
    `${outDir}/l2-genesis.json`,
    await renderL2Genesis(fork.l2GenesisTemplate, opTimestampSeconds, fork.l2ConfigExtra),
  );
  await Deno.writeTextFile(
    `${outDir}/rollup.json`,
    await renderRollup({
      templateUrl: fork.rollupTemplate,
      l1Hash,
      l2Hash,
      l2TimeSeconds: opTimestampSeconds,
      blockTimeSeconds: opts.l2BlockTimeSeconds,
      extra: fork.rollupExtra,
    }),
  );

  return { genesisTimeSeconds };
}
