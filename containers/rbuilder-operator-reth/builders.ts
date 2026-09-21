// Production's ordering builders: the algorithms rbuilder runs in parallel for
// every block, each with its own deadline and sorting rule. Kept separate from
// the config template because this list tracks production and changes on its
// own schedule.

// Production's eight ordering builders.
export const PRODUCTION_BUILDERS = [
  { name: "mp-ordering-25ms", deadline: 25, sorting: "max-profit" },
  { name: "mgp-ordering-200ms", deadline: 200, sorting: "mev-gas-price" },
  {
    name: "mgp-ordering-45-5ms",
    deadline: 45,
    pre: 5,
    sorting: "mev-gas-price",
  },
  { name: "type-ordering-200ms", deadline: 200, sorting: "type-max-profit" },
  {
    name: "type-ordering-45-5ms",
    deadline: 45,
    pre: 5,
    sorting: "type-max-profit",
  },
  { name: "mp-ordering-200ms", deadline: 200, sorting: "max-profit" },
  { name: "mp-ordering-95-5ms", deadline: 95, pre: 5, sorting: "max-profit" },
  { name: "mp-ordering-45-5ms", deadline: 45, pre: 5, sorting: "max-profit" },
];

export function builderBlock(
  b: { name: string; deadline: number; pre?: number; sorting: string },
): string {
  return `[[builders]]
name = "${b.name}"
algo = "ordering-builder"
build_duration_deadline_ms = ${b.deadline}
${
    b.pre !== undefined
      ? `pre_filtered_build_duration_deadline_ms = ${b.pre}\n`
      : ""
  }discard_txs = true
drop_failed_orders = true
failed_order_retries = 1
sorting = "${b.sorting}"
ignore_mempool_profit_on_bundles = true
bob_build_duration_deadline_ms = 10
`;
}
