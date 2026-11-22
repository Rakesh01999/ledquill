/**
 * Decimal arithmetic on strings, for showing a computed sum next to a printed subtotal.
 * Money never goes through a float: values are scaled to BigInt integers, added, and written
 * back as text.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const MONEY_INPUT = /^-?\d+(\.\d{1,2})?$/;

type Scaled = { int: bigint; scale: number };

function toScaled(value: string): Scaled | null {
  const m = DECIMAL.exec(value.trim());
  if (!m) return null;
  const frac = m[3] ?? "";
  const int = BigInt(`${m[2] ?? "0"}${frac}`) * (m[1] === "-" ? -1n : 1n);
  return { int, scale: frac.length };
}

function rescale(v: Scaled, scale: number): bigint {
  return v.int * 10n ** BigInt(scale - v.scale);
}

function fromScaled(int: bigint, scale: number, minDecimals = 2): string {
  const negative = int < 0n;
  const digits = (negative ? -int : int).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).padEnd(minDecimals, "0");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** True for what the API accepts as money: optional minus, digits, at most two decimals. */
export function isMoneyInput(value: string): boolean {
  return MONEY_INPUT.test(value.trim());
}

/** "1150" -> "1150.00", "0012.5" -> "12.50". Null when not a plain decimal. */
export function normalizeMoney(value: string): string | null {
  const s = toScaled(value);
  return s ? fromScaled(s.int, s.scale) : null;
}

/** Sum of the values that are plain decimals; empty and invalid entries are skipped. */
export function sumDecimals(values: (string | null | undefined)[]): string | null {
  const parts = values.flatMap((v) => {
    const s = v == null ? null : toScaled(v);
    return s ? [s] : [];
  });
  if (parts.length === 0) return null;
  const scale = Math.max(...parts.map((p) => p.scale));
  return fromScaled(parts.reduce((acc, p) => acc + rescale(p, scale), 0n), scale);
}

/** a - b as text, or null when either is not a plain decimal. */
export function subtractDecimals(a: string, b: string): string | null {
  const x = toScaled(a);
  const y = toScaled(b);
  if (!x || !y) return null;
  const scale = Math.max(x.scale, y.scale);
  return fromScaled(rescale(x, scale) - rescale(y, scale), scale);
}

export function isZeroDecimal(value: string): boolean {
  const s = toScaled(value);
  return s !== null && s.int === 0n;
}
