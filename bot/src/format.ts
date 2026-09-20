/**
 * Money and odds as Discord-readable text.
 *
 * Kept apart from the transaction formatter because these are shared by every command, and because
 * getting cents-to-dollars wrong is the kind of error that is invisible in a screenshot and obvious
 * to the person whose balance it is.
 */

/** Cents to `$1,234.56`. Everything in the ledger is integer cents; nothing is ever a float. */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}`;
}

/** A signed figure, so a profit and loss column reads at a glance. */
export function signedMoney(cents: number): string {
  return `${cents > 0 ? '+' : ''}${money(cents)}`;
}

export function americanOdds(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}

export function percent(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * Pads a column for a monospace block.
 *
 * Discord renders proportional text everywhere except a code block, so any table has to live in
 * one — which means the padding is ours to do, and a name longer than the column would otherwise
 * break every row below it.
 */
/**
 * A two-tone probability bar, mirroring the site's matchup meter.
 *
 * Kept SHORT (12 cells). It lives inside an embed field beside a percentage, and a long bar is what
 * pushed the first version of the markets board past an embed's usable width on mobile.
 *
 * Clamped to at least one cell on each side so a near-certain market still reads as a bar rather
 * than a solid block with no indication of which way it points.
 */
export function meter(probability: number, cells = 12): string {
  const filled = Math.max(1, Math.min(cells - 1, Math.round(probability * cells)));
  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

export function pad(value: string, width: number): string {
  /*
   * A truncated value keeps one trailing space, so it can never run into the next column.
   * Slicing to the full width looks correct until a name is exactly long enough to fill it:
   * "AggressiveIyAvg" in a 13-wide column produced "AggressiveIyAegruis", two values fused into one
   * unreadable token.
   */
  if (value.length >= width) return value.slice(0, width - 1) + ' ';
  return value + ' '.repeat(width - value.length);
}

export function padLeft(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return ' '.repeat(width - value.length) + value;
}
