import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";

// A reth p2p bootnode for L2 discovery. Only needed with an external builder:
// op-geth (the sequencer EL) and op-rbuilder (the builder) both dial it, discover
// each other, and peer — that's how op-rbuilder syncs the chain it builds on.
//
// The p2p secret key is the deterministic hardhat-style key 0x00…01, so the
// bootnode's enode ID is a constant (secp256k1 G) that peers can hardcode.
export const BOOTNODE_SECRET_KEY = "0000000000000000000000000000000000000000000000000000000000000001";
export const BOOTNODE_ID =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";

// p2p only — reached over pod DNS (peers hardcode host "bootnode" + port 30303),
// so nothing is host-published.
export const ports: Ports = {};

export function buildContainer(_def: ContainerDef, _ctx: Ctx): ContainerResult {
  return {
    container: {
      image: "ghcr.io/paradigmxyz/reth:v1.9.3",
      command: ["/usr/local/bin/reth"],
      args: [
        "p2p",
        "bootnode",
        "--addr", "0.0.0.0:30303",
        "--p2p-secret-key", "/config/p2p_key.txt",
        "-vvvv",
        "--color", "never",
        "--nat", "none",
        "--v5",
      ],
    },
    configs: [
      { filename: "p2p_key.txt", content: BOOTNODE_SECRET_KEY, mountPath: "/config/p2p_key.txt" },
    ],
  };
}
