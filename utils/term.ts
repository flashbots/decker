const enabled = (() => {
  if (Deno.env.get("NO_COLOR")) return false;
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
})();

const wrap = (open: number, close: number) => (s: string) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const underline = wrap(4, 24);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export function ms(start: number): string {
  const d = performance.now() - start;
  return d < 1000 ? `${d.toFixed(0)}ms` : `${(d / 1000).toFixed(1)}s`;
}
