/**
 * Display formatting for money and quantities. Values arrive from the API as decimal strings
 * and stay strings: they are grouped and padded as text, never parsed to a number.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * "1150" -> "1,150.00", "99.0000" -> "99.00", "0.1250" -> "0.125". At least `minDecimals` places,
 * and extra places only where they carry a digit: nothing is rounded. Returns null when the value
 * is not a plain decimal string.
 */
export function formatDecimal(value: string | null | undefined, minDecimals = 2): string | null {
  if (value == null) return null;
  const m = DECIMAL.exec(value.trim());
  if (!m) return null;
  const sign = m[1] ?? "";
  const whole = m[2] ?? "0";
  const frac = m[3] ?? "";
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = frac.replace(/0+$/, "").padEnd(minDecimals, "0");
  return `${sign}${grouped}${decimals ? `.${decimals}` : ""}`;
}

/** Quantities keep the decimals the document printed, trailing zeros trimmed: "2.0000" -> "2". */
export function formatQuantity(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = /^-?\d+\.\d+$/.test(value) ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return formatDecimal(trimmed, 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" -> "14 Nov 2026". Works on the text, so no time zone can shift the day. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
