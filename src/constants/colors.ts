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
