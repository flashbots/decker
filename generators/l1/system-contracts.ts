// Genesis predeploys for a BuilderNet-shaped devnet, as `genesisAccounts`
// (artifacts spec, see el-genesis.ts / state-root.ts). Mainnet has all of them.
//
// PaymentForwarder (mainnet runtime code at 0xFEEEEEE4...7ffC; rbuilder-prism
// crates/rbuilder/src/building/payout_tx.rs): the builder's proposer payout
// and bundle refunds CALL it and it forwards msg.value to the recipient in its
// calldata via SELFDESTRUCT, keeping no storage and emitting no logs. The
// bidding gateway's seal relies on exactly that - it re-signs the payout at
// the bid value and folds only the builder's and the proposer's balance into
// the builder-shipped tries. Without the contract the CALL succeeds against
// empty code, the value stays at 0xFEEE..., and every sealed block fails
// `mismatched block state root` (rbuilder-prism e2e.yaml: "manual only until
// builder-playground ships the PaymentForwarder in its L1 genesis").
//
// EIP-4788 / 2935 / 7002 / 7251 system contracts (bytecodes from alloy-eips
// 2.0.5, the constants reth itself uses): reth runs their pre/post-block
// system calls every block; without code there they touch non-existent
// accounts, a state-diff shape mainnet never produces.
import type { GenesisAlloc } from "./state-root.ts";

export const PAYMENT_FORWARDER_ADDRESS = "0xFEEEEEE44046c3f61a8CC081E0918eF0de0a7ffC";

const CODE = {
  paymentForwarder: "0x5f358060e01c4218600f5760401cff5b5f5ffd00",
  eip4788: "0x3373fffffffffffffffffffffffffffffffffffffffe14604d57602036146024575f5ffd5b5f35801560495762001fff810690815414603c575f5ffd5b62001fff01545f5260205ff35b5f5ffd5b62001fff42064281555f359062001fff015500",
  eip2935: "0x3373fffffffffffffffffffffffffffffffffffffffe14604657602036036042575f35600143038111604257611fff81430311604257611fff9006545f5260205ff35b5f5ffd5b5f35611fff60014303065500",
  eip7002: "0x3373fffffffffffffffffffffffffffffffffffffffe1460cb5760115f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff146101f457600182026001905f5b5f82111560685781019083028483029004916001019190604d565b909390049250505036603814608857366101f457346101f4575f5260205ff35b34106101f457600154600101600155600354806003026004013381556001015f35815560010160203590553360601b5f5260385f601437604c5fa0600101600355005b6003546002548082038060101160df575060105b5f5b8181146101835782810160030260040181604c02815460601b8152601401816001015481526020019060020154807fffffffffffffffffffffffffffffffff00000000000000000000000000000000168252906010019060401c908160381c81600701538160301c81600601538160281c81600501538160201c81600401538160181c81600301538160101c81600201538160081c81600101535360010160e1565b910180921461019557906002556101a0565b90505f6002555f6003555b5f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff14156101cd57505f5b6001546002828201116101e25750505f6101e8565b01600290035b5f555f600155604c025ff35b5f5ffd",
  eip7251: "0x3373fffffffffffffffffffffffffffffffffffffffe1460d35760115f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1461019a57600182026001905f5b5f82111560685781019083028483029004916001019190604d565b9093900492505050366060146088573661019a573461019a575f5260205ff35b341061019a57600154600101600155600354806004026004013381556001015f358155600101602035815560010160403590553360601b5f5260605f60143760745fa0600101600355005b6003546002548082038060021160e7575060025b5f5b8181146101295782810160040260040181607402815460601b815260140181600101548152602001816002015481526020019060030154905260010160e9565b910180921461013b5790600255610146565b90505f6002555f6003555b5f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff141561017357505f5b6001546001828201116101885750505f61018e565b01600190035b5f555f6001556074025ff35b5f5ffd0000",
};

const predeploy = (code: string) => ({ nonce: "0x1", balance: "0x0", code });

export const BUILDERNET_GENESIS_ACCOUNTS: GenesisAlloc = {
  [PAYMENT_FORWARDER_ADDRESS]: predeploy(CODE.paymentForwarder),
  "0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02": predeploy(CODE.eip4788), // beacon roots
  "0x0000F90827F1C53a10cb7A02335B175320002935": predeploy(CODE.eip2935), // history storage
  "0x00000961Ef480Eb55e80D19ad83579A64c007002": predeploy(CODE.eip7002), // withdrawal requests
  "0x0000BBdDc7CE488642fb579F8B00f3a590007251": predeploy(CODE.eip7251), // consolidation requests
};
