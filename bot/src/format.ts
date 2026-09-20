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
export function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

export function padLeft(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return ' '.repeat(width - value.length) + value;
}
