export const POSITION_COLORS: Record<string, string> = {
  QB: '#f87171', // Red/Pink
  RB: '#4ade80', // Green
  WR: '#60a5fa', // Blue
  TE: '#fbbf24', // Amber/Orange
  K: '#c084fc',  // Purple
  DEF: '#94a3b8', // Slate
  DL: '#94a3b8',
  LB: '#94a3b8',
  DB: '#94a3b8',
  FLEX: '#a8a29e',
  SUPER_FLEX: '#a8a29e',
  IDP: '#94a3b8',
  BENCH: '#78716c',
  BN: '#78716c'
};

export const getPositionColor = (position: string): string => {
  return POSITION_COLORS[position] || '#9ca3af'; // Default Gray
};

export const getPositionBgColor = (position: string, opacity: number = 0.15): string => {
  const hex = POSITION_COLORS[position] || '#9ca3af';
  // Simple hex to rgba conversion
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

/**
 * Two-sided market colours for the betting probability meter.
 *
 * These are data-mark steps, not the theme's UI accents. The theme's
 * primary (#90caf9) and secondary (#f48fb1) FAIL palette validation against the
 * dark chart surface (#1e1e1e): both sit outside the L 0.48-0.67 band and
 * #90caf9 falls under the chroma floor at 0.09, so it reads gray as a fill.
 *
 * These are the nearest passing steps in the same hue families (MUI blue 500 /
 * pink 400) and clear every check — CVD separation ΔE 20.1 (protan), 36.5
 * (tritan), normal vision 32.4, contrast >= 3:1 against the surface. Colour is
 * identity here, never rank: side A is always SIDE_A_COLOR regardless of who is
 * favoured, so a line moving never repaints the sides.
 */
export const MARKET_SIDE_COLORS = {
  a: '#2196f3',
  b: '#ec407a',
} as const;

/** Reference marker at an even market, drawn as a recessive hairline. */
export const MARKET_EVEN_REFERENCE = 'rgba(255, 255, 255, 0.38)';
