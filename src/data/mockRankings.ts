import { Player } from '@/services/draft/vbdService';

export const MOCK_RANKINGS: Player[] = [
  { player_id: '4046', name: 'Patrick Mahomes', position: 'QB', team: 'KC', rank: 1, tier: 1, projected_points: 350 },
  { player_id: '96', name: 'Josh Allen', position: 'QB', team: 'BUF', rank: 2, tier: 1, projected_points: 360 },
  { player_id: '6794', name: 'Jalen Hurts', position: 'QB', team: 'PHI', rank: 3, tier: 1, projected_points: 340 },
  { player_id: '4881', name: 'Lamar Jackson', position: 'QB', team: 'BAL', rank: 4, tier: 1, projected_points: 330 },
  
  { player_id: '6813', name: 'Christian McCaffrey', position: 'RB', team: 'SF', rank: 1, tier: 1, projected_points: 300 },
  { player_id: '9229', name: 'Bijan Robinson', position: 'RB', team: 'ATL', rank: 2, tier: 1, projected_points: 260 },
  { player_id: '8151', name: 'Breece Hall', position: 'RB', team: 'NYJ', rank: 3, tier: 1, projected_points: 255 },
  { player_id: '6790', name: 'Jonathan Taylor', position: 'RB', team: 'IND', rank: 4, tier: 1, projected_points: 240 },
  
  { player_id: '7564', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', rank: 1, tier: 1, projected_points: 280 },
  { player_id: '8112', name: 'Tyreek Hill', position: 'WR', team: 'MIA', rank: 2, tier: 1, projected_points: 275 },
  { player_id: '6801', name: 'Justin Jefferson', position: 'WR', team: 'MIN', rank: 3, tier: 1, projected_points: 270 },
  { player_id: '7523', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', rank: 4, tier: 1, projected_points: 260 },
  { player_id: '7596', name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN', rank: 5, tier: 1, projected_points: 255 },
  
  { player_id: '5012', name: 'Travis Kelce', position: 'TE', team: 'KC', rank: 1, tier: 1, projected_points: 200 },
  { player_id: '9509', name: 'Sam LaPorta', position: 'TE', team: 'DET', rank: 2, tier: 1, projected_points: 190 },
  { player_id: '5870', name: 'Mark Andrews', position: 'TE', team: 'BAL', rank: 3, tier: 2, projected_points: 170 },
  
  // Tier 2s
  { player_id: '4984', name: 'Josh Jacobs', position: 'RB', team: 'GB', rank: 15, tier: 2, projected_points: 220 },
  { player_id: '8138', name: 'Isiah Pacheco', position: 'RB', team: 'KC', rank: 16, tier: 2, projected_points: 215 },
  { player_id: '9226', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', rank: 17, tier: 2, projected_points: 210 },
  
  { player_id: '8160', name: 'Garrett Wilson', position: 'WR', team: 'NYJ', rank: 18, tier: 2, projected_points: 240 },
  { player_id: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR', rank: 19, tier: 2, projected_points: 235 },
  { player_id: '5872', name: 'A.J. Brown', position: 'WR', team: 'PHI', rank: 20, tier: 2, projected_points: 230 }
];
