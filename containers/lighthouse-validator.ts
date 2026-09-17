import type { ContainerResult, ContainerDef, Ctx } from "../utils/types.ts";

export const ports = {};

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const beacon = def.refs?.beacon;
  if (!beacon) throw new Error(`validator ${def.name}: missing refs.beacon`);
  return {
    container: {
      image: "docker.io/sigp/lighthouse:v8.1.0",
      command: ["lighthouse"],
      args: [
        "vc",
        "--datadir", "/data_validator",
        "--testnet-dir", "/artifacts/testnet",
        "--init-slashing-protection",
        "--beacon-nodes", ctx.url(beacon, "http"),
        // config.feeRecipient overrides the default: a PBS gateway proves the proposer
        // payment against state, so the recipient must EXIST in genesis (buildernet-node).
        "--suggested-fee-recipient", (def.config?.feeRecipient as string | undefined) ?? "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
        "--builder-proposals",
        "--prefer-builder-proposals",
      ],
      volumeMounts: [
        { name: "artifacts",      mountPath: "/artifacts",      readOnly: true },
        { name: "data-validator", mountPath: "/data_validator" },
      ],
    },
    volumes: [
      { name: "artifacts",      kind: "shared-readonly" },
      { name: "data-validator", kind: "from-shared", subPath: "data_validator" },
    ],
  };
}
