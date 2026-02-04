export type Player = {
  player_id: string;
  name: string;
  position: string;
  team?: string;
  rank?: number;
  tier?: number;
  projected_points?: number;
  adp?: number;
  vbd_value?: number;
  position_rank?: number;
};

export type LeagueSettings = {
  teams: number;
  format: 'standard' | 'superflex' | 'ppr' | 'half_ppr';
  roster: Record<string, number>; // QB: 1, RB: 2...
};

export type VBDMetrics = {
  vbd_value: number;
  baseline_points: number;
  projected_points: number;
  scarcity_multiplier: number;
  position_scarcity: 'High' | 'Medium' | 'Low';
};

const SCARCITY_MULTIPLIERS: Record<string, number> = {
  QB: 1.0,
  RB: 1.3,
  WR: 1.1,
  TE: 1.5,
  K: 0.8,
  DEF: 0.8
};

// Point estimates by Tier (Fallback if no projections)
const TIER_POINTS: Record<string, Record<number, number>> = {
  QB: { 1: 320, 2: 300, 3: 280, 4: 260, 5: 240, 6: 220, 7: 200, 8: 180 },
  RB: { 1: 280, 2: 250, 3: 220, 4: 200, 5: 180, 6: 160, 7: 140, 8: 120 },
  WR: { 1: 260, 2: 230, 3: 200, 4: 180, 5: 160, 6: 140, 7: 120, 8: 100 },
  TE: { 1: 180, 2: 150, 3: 130, 4: 110, 5: 95, 6: 85, 7: 75, 8: 65 },
  K: { 1: 140, 2: 130, 3: 125, 4: 120, 5: 115, 6: 110, 7: 105, 8: 100 },
  DEF: { 1: 150, 2: 140, 3: 130, 4: 125, 5: 120, 6: 115, 7: 110, 8: 105 }
};

export class VBDService {
  
  static calculate(players: Player[], settings: LeagueSettings): Player[] {
    const baselines = this.calculateBaselines(players, settings);
    
    return players.map(p => {
      if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position)) return p;

      const proj = p.projected_points ?? this.estimatePoints(p);
      if (!proj) return p;

      const baseline = baselines[p.position] || 0;
      const rawVbd = proj - baseline;
      const multiplier = SCARCITY_MULTIPLIERS[p.position] || 1.0;
      const adjustedVbd = rawVbd * multiplier;

      return {
        ...p,
        projected_points: proj,
        vbd_value: adjustedVbd
      };
    }).sort((a, b) => (b.vbd_value || -999) - (a.vbd_value || -999));
  }

  private static calculateBaselines(players: Player[], settings: LeagueSettings): Record<string, number> {
    const baselines: Record<string, number> = {};
    const byPos: Record<string, Player[]> = {};

    // Group
    players.forEach(p => {
      if (!byPos[p.position]) byPos[p.position] = [];
      byPos[p.position].push(p);
    });

    Object.keys(byPos).forEach(pos => {
      const available = byPos[pos].sort((a, b) => 
        (b.projected_points ?? this.estimatePoints(b)) - (a.projected_points ?? this.estimatePoints(a))
      );

      // Determine "Replacement Level" index
      // Base starters + Flex share + Bench
      const base = (settings.roster[pos] || 0) * settings.teams;
      
      let flexAdd = 0;
      if (['RB', 'WR', 'TE'].includes(pos)) {
        flexAdd += (settings.roster['FLEX'] || 0) * settings.teams * 0.3; // 30% share
      }
      if (['QB', 'RB', 'WR', 'TE'].includes(pos) && settings.format === 'superflex') {
        flexAdd += (settings.roster['SUPER_FLEX'] || 0) * settings.teams * 0.2;
      }

      // Bench multiplier
      const benchMult = this.getBenchMultiplier(pos);
      const totalDemand = Math.floor(base + flexAdd + (base * benchMult));

      const cutoffIndex = Math.min(totalDemand, available.length - 1);
      const baselinePlayer = available[cutoffIndex];
      baselines[pos] = baselinePlayer ? (baselinePlayer.projected_points ?? this.estimatePoints(baselinePlayer)) : 0;
    });

    return baselines;
  }

  private static estimatePoints(p: Player): number {
    if (p.projected_points) return p.projected_points;
    const tier = p.tier || (p.rank ? Math.ceil(p.rank / 12) : 10);
    const table = TIER_POINTS[p.position];
    if (table && table[tier]) return table[tier];
    
    // Extrapolate if low tier
    const base = TIER_POINTS[p.position]?.[8] || 50;
    return Math.max(10, base - (tier - 8) * 10);
  }

  private static getBenchMultiplier(pos: string): number {
    switch (pos) {
      case 'QB': return 0.5;
      case 'RB': return 1.5;
      case 'WR': return 1.2;
      case 'TE': return 0.8;
      default: return 0.1;
    }
  }
}
