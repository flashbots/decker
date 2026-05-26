import type { ContainerResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {};

const IMPORT_SCRIPT = `set -e
WALLET=/data_validator/prysm-wallet
WALLET_PW=/data_validator/wallet-password.txt
if [ ! -d "$WALLET" ]; then
  mkdir -p /tmp/keystores
  i=0
  for f in /lh_validators/*/voting-keystore.json; do
    cp "$f" "/tmp/keystores/keystore-$i.json"
    i=$((i+1))
  done
  printf '%s' "secret" > /tmp/account-password.txt
  printf '%s' "decker-prysm-wallet" > "$WALLET_PW"
  /app/cmd/validator/validator accounts import \\
    --accept-terms-of-use \\
    --keys-dir=/tmp/keystores \\
    --wallet-dir="$WALLET" \\
    --wallet-password-file="$WALLET_PW" \\
    --account-password-file=/tmp/account-password.txt
  rm -rf /tmp/keystores /tmp/account-password.txt
fi
exec /app/cmd/validator/validator "$@"
`;

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  if (!beacon) throw new Error(`prysm-validator ${def.name}: missing refs.beacon`);
  return {
    container: {
      image: "gcr.io/prysmaticlabs/prysm/validator:stable",
      command: ["sh", "-c", IMPORT_SCRIPT, "sh"],
      args: [
        "--accept-terms-of-use",
        "--datadir", "/data_validator/db",
        "--wallet-dir", "/data_validator/prysm-wallet",
        "--wallet-password-file", "/data_validator/wallet-password.txt",
        "--chain-config-file", "/artifacts/testnet/config.yaml",
        "--enable-beacon-rest-api",
        "--beacon-rest-api-provider", ctx.url(beacon, "http"),
        "--suggested-fee-recipient", "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
        "--enable-builder",
      ],
      volumeMounts: [
        { name: "artifacts",     mountPath: "/artifacts",     readOnly: true },
        { name: "lh-validators", mountPath: "/lh_validators", readOnly: true },
        { name: "data",          mountPath: "/data_validator" },
      ],
    },
    volumes: [
      { name: "artifacts",     kind: "shared-readonly" },
      { name: "lh-validators", kind: "from-shared", subPath: "data_validator/validators" },
      { name: "data",          kind: "ephemeral" },
    ],
  };
}
