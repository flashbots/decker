export const JWT_SECRET = "04592280e1778419b7aa954d43871cb2cfb2ebda754fb735e8adeb293a88f9bf";

// Lighthouse keystore password — used for every validator keystore in
// data_validator/secrets/. Must match the encryption used in bls_keys.json.
export const KEYSTORE_SECRET = "secret";

export const MIN_GENESIS_DELAY_SECONDS = 10;
export const DEFAULT_L1_BLOCK_TIME_SECONDS = 12;

// Hardhat/Anvil's deterministic test mnemonic accounts. These are the
// secp256k1 private keys whose derived addresses get pre-funded in genesis.
export const STATIC_PREFUNDED_PRIVKEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
] as const;

export const PREFUNDED_BALANCE_HEX = "0x10000000000000000000000";

export const DEPOSIT_CONTRACT_ADDRESS = "0x4242424242424242424242424242424242424242";
export const DEPOSIT_CHAIN_ID = 1337;
