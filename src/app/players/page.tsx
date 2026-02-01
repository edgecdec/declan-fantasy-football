'use client';

import * as React from 'react';
import { Container, Typography, Chip } from '@mui/material';
import { Player } from '@/types/player';
import SmartTable, { SmartColumn } from '@/components/common/SmartTable';
import PageHeader from '@/components/common/PageHeader';
import playerData from '../../../data/sleeper_players.json';

// --- Data Preparation ---
const ALL_PLAYERS: Player[] = Object.values(playerData.players)
  .filter((p: any) => p.position && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position))
  .map((p: any) => ({
    player_id: p.player_id,
    first_name: p.first_name,
    last_name: p.last_name,
    position: p.position,
    team: p.team || 'FA',
    active: p.active,
    age: p.age,
    number: p.number,
    stats: p.stats || null
  }));

// Pre-calculate teams list just in case, though SmartTable can auto-derive
const TEAMS = Array.from(new Set(ALL_PLAYERS.map(p => p.team).filter(t => t && t !== 'FA'))).sort() as string[];

export default function PlayersPage() {
  
  // Column Definition
  const columns: SmartColumn<Player>[] = [
    { 
      id: 'last_name', 
      label: 'Name', 
      render: (p) => (
        <Typography variant="body2" fontWeight="medium">
          {p.first_name} {p.last_name}
        </Typography>
      )
    },
    { 
      id: 'position', 
      label: 'Pos', 
      filterVariant: 'multi-select',
      filterOptions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
      render: (p) => (
        <Chip 
          label={p.position} 
          size="small" 
          variant="outlined"
          color={
            p.position === 'QB' ? 'error' :
            p.position === 'RB' ? 'success' :
            p.position === 'WR' ? 'info' :
            p.position === 'TE' ? 'warning' : 'default'
          }
        />
      )
    },
    { 
      id: 'team', 
      label: 'Team',
      filterVariant: 'multi-select',
      filterOptions: TEAMS 
    },
    { 
      id: 'stats.pts_std', 
      label: 'Std Pts', 
      numeric: true, 
      render: (p) => p.stats?.pts_std?.toFixed(1) || '-' 
    },
    { 
      id: 'stats.pts_half_ppr', 
      label: 'Half PPR', 
      numeric: true, 
      render: (p) => (
        <Typography fontWeight="bold" color="primary.main">
          {p.stats?.pts_half_ppr?.toFixed(1) || '-'}
        </Typography>
      )
    },
    { 
      id: 'stats.pts_ppr', 
      label: 'PPR Pts', 
      numeric: true, 
      render: (p) => p.stats?.pts_ppr?.toFixed(1) || '-' 
    },
    { 
      id: 'stats.gp', 
      label: 'GP', 
      numeric: true, 
      render: (p) => p.stats?.gp || '-' 
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Player Database" 
        subtitle="Search and filter all active NFL players and view 2025 stats." 
      />
      
      <SmartTable
        data={ALL_PLAYERS}
        columns={columns}
        keyField="player_id"
        defaultSortBy="stats.pts_half_ppr"
        defaultSortOrder="desc"
        defaultRowsPerPage={25}
      />
    </Container>
  );
}
