'use client';

import * as React from 'react';
import { 
  Container, 
  Typography, 
  TablePagination,
} from '@mui/material';

// Import Types and Components
import { Player, PlayerStats, Order } from '@/types/player';
import PlayerTable from '@/components/players/PlayerTable';
import PlayerFilterBar from '@/components/players/PlayerFilterBar';

// Import JSON data
import playerData from '../../../data/sleeper_players.json';

// 1. Process data on load
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

// Extract unique teams for dropdown
const TEAMS = Array.from(new Set(ALL_PLAYERS.map(p => p.team).filter(t => t && t !== 'FA'))).sort() as string[];

// Sorting Helper
function descendingComparator<T>(a: T, b: T, orderBy: keyof T | string) {
  let aValue: any;
  let bValue: any;

  // Handle nested stats sorting
  if (typeof orderBy === 'string' && orderBy.startsWith('stats.')) {
    const statKey = orderBy.split('.')[1] as keyof PlayerStats;
    aValue = (a as any).stats?.[statKey] ?? -9999;
    bValue = (b as any).stats?.[statKey] ?? -9999;
  } else {
    aValue = (a as any)[orderBy] ?? '';
    bValue = (b as any)[orderBy] ?? '';
    if (typeof aValue === 'string') aValue = aValue.toLowerCase();
    if (typeof bValue === 'string') bValue = bValue.toLowerCase();
  }

  if (bValue < aValue) return -1;
  if (bValue > aValue) return 1;
  return 0;
}

function getComparator<Key extends keyof any>(
  order: Order,
  orderBy: Key,
): (a: any, b: any) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy as string)
    : (a, b) => -descendingComparator(a, b, orderBy as string);
}

export default function PlayersPage() {
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(25);
  
  // Filter State
  const [filterName, setFilterName] = React.useState('');
  const [filterPos, setFilterPos] = React.useState<string[]>([]);
  const [filterTeam, setFilterTeam] = React.useState<string[]>([]);
  
  // Sorting State
  const [order, setOrder] = React.useState<Order>('desc');
  const [orderBy, setOrderBy] = React.useState<string>('stats.pts_half_ppr');

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // Reset page when filters change
  const handleFilterChange = (setter: any) => (value: any) => {
    setter(value);
    setPage(0);
  };

  // 1. Filter
  const filteredPlayers = React.useMemo(() => {
    return ALL_PLAYERS.filter(player => {
      const matchesName = 
        player.first_name.toLowerCase().includes(filterName.toLowerCase()) || 
        player.last_name.toLowerCase().includes(filterName.toLowerCase());
      
      const matchesPos = filterPos.length === 0 || filterPos.includes(player.position);
      const matchesTeam = filterTeam.length === 0 || (player.team && filterTeam.includes(player.team));

      return matchesName && matchesPos && matchesTeam;
    });
  }, [filterName, filterPos, filterTeam]);

  // 2. Sort & Paginate
  const visibleRows = React.useMemo(() => {
    const sorted = [...filteredPlayers].sort(getComparator(order, orderBy));
    return sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [filteredPlayers, order, orderBy, page, rowsPerPage]);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Player Database & Stats (2025)
      </Typography>
      
      <PlayerFilterBar
        filterName={filterName}
        setFilterName={handleFilterChange(setFilterName)}
        filterPos={filterPos}
        setFilterPos={handleFilterChange(setFilterPos)}
        filterTeam={filterTeam}
        setFilterTeam={handleFilterChange(setFilterTeam)}
        teamsList={TEAMS}
      />

      <PlayerTable
        players={visibleRows}
        order={order}
        orderBy={orderBy}
        onRequestSort={handleRequestSort}
      />
      
      <TablePagination
        rowsPerPageOptions={[25, 50, 100]}
        component="div"
        count={filteredPlayers.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={(e, newPage) => setPage(newPage)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Container>
  );
}
