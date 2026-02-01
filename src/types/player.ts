export type PlayerStats = {
  pts_std: number;
  pts_half_ppr: number;
  pts_ppr: number;
  gp: number;
  pass_yd: number;
  pass_td: number;
  rush_yd: number;
  rush_td: number;
  rec_yd: number;
  rec_td: number;
};

export type Player = {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
  active: boolean;
  age?: number;
  number?: number;
  stats?: PlayerStats; 
};

export type Order = 'asc' | 'desc';
