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

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function color(hex: string): (s: string) => string {
  if (!enabled) return (s) => s;
  const [r, g, b] = rgb(hex);
  return (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const underline = wrap(4, 24);

export const success = color("#5dd39e");
export const accent = color("#7aa7ff");
export const warn = color("#f6c177");
export const err = color("#ef4444");
export const muted = color("#737373");

export const green = success;
export const cyan = accent;
export const yellow = warn;
export const red = err;

export function ms(start: number): string {
  const d = performance.now() - start;
  return d < 1000 ? `${d.toFixed(0)}ms` : `${(d / 1000).toFixed(1)}s`;
}

function consoleWidth(): number {
  try {
    return Deno.consoleSize().columns;
  } catch {
    return 80;
  }
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

function lr(left: string, right: string): string {
  const w = consoleWidth();
  const used = visibleLen(left) + visibleLen(right);
  if (used + 2 > w) return `${left}  ${right}`;
  return `${left}${" ".repeat(w - used)}${right}`;
}

export function rule(title?: string) {
  const w = consoleWidth();
  const ch = "─";
  if (!title) {
    console.log(muted(ch.repeat(w)));
    return;
  }
  const inner = ` ${title} `;
  const pre = 2;
  const rest = Math.max(0, w - pre - inner.length);
  console.log(muted(ch.repeat(pre)) + dim(inner) + muted(ch.repeat(rest)));
}

export type Spinner = {
  label: string;
  t0: number;
  timer: number | null;
  frame: number;
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ENC = new TextEncoder();
function writeRaw(s: string) {
  try {
    Deno.stdout.writeSync(ENC.encode(s));
  } catch { /* ignore */ }
}

function clearLine() {
  if (enabled) writeRaw("\r\x1b[2K");
}

export function step(label: string): Spinner {
  const sp: Spinner = { label, t0: performance.now(), timer: null, frame: 0 };
  if (!enabled) {
    console.log(`${dim("→")} ${label}…`);
    return sp;
  }
  const tick = () => {
    writeRaw(`\r${accent(FRAMES[sp.frame])} ${sp.label}…`);
    sp.frame = (sp.frame + 1) % FRAMES.length;
  };
  tick();
  sp.timer = setInterval(tick, 80);
  return sp;
}

export function done(sp: Spinner, extra?: string) {
  if (sp.timer !== null) clearInterval(sp.timer);
  clearLine();
  const left = `${success("✓")} ${sp.label}${extra ? ` ${dim(`(${extra})`)}` : ""}`;
  const right = dim(ms(sp.t0));
  console.log(lr(left, right));
}

export function fail(sp: Spinner, msg: string) {
  if (sp.timer !== null) clearInterval(sp.timer);
  clearLine();
  console.error(`${err("✗")} ${sp.label}: ${msg}`);
}

export function note(symbol: string, label: string, t0?: number) {
  const left = `${symbol} ${label}`;
  if (t0 === undefined) {
    console.log(left);
    return;
  }
  console.log(lr(left, dim(ms(t0))));
}

export function summary(entries: Array<[string, string]>) {
  if (entries.length === 0) return;
  const labelW = Math.max(...entries.map(([k]) => k.length));
  console.log("");
  for (const [k, v] of entries) {
    console.log(`  ${bold(k.padEnd(labelW))}  ${accent(v)}`);
  }
}
