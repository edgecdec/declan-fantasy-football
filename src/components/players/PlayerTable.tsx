'use client';

import * as React from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Chip,
  Typography
} from '@mui/material';
import { Player, Order } from '@/types/player';

interface HeadCell {
  id: string;
  label: string;
  numeric: boolean;
}

const HEAD_CELLS: HeadCell[] = [
  { id: 'last_name', label: 'Name', numeric: false },
  { id: 'position', label: 'Pos', numeric: false },
  { id: 'team', label: 'Team', numeric: false },
  { id: 'stats.pts_std', label: 'Std Pts', numeric: true },
  { id: 'stats.pts_half_ppr', label: 'Half PPR', numeric: true },
  { id: 'stats.pts_ppr', label: 'PPR Pts', numeric: true },
  { id: 'stats.gp', label: 'GP', numeric: true },
];

interface PlayerTableProps {
  players: Player[];
  order: Order;
  orderBy: string;
  onRequestSort: (property: string) => void;
}

export default function PlayerTable({ players, order, orderBy, onRequestSort }: PlayerTableProps) {
  const createSortHandler = (property: string) => () => {
    onRequestSort(property);
  };

  return (
    <TableContainer component={Paper}>
      <Table sx={{ minWidth: 750 }} size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'background.default' }}>
            {HEAD_CELLS.map((headCell) => (
              <TableCell
                key={headCell.id}
                align={headCell.numeric ? 'right' : 'left'}
                sortDirection={orderBy === headCell.id ? order : false}
                sx={{ fontWeight: 'bold' }}
              >
                <TableSortLabel
                  active={orderBy === headCell.id}
                  direction={orderBy === headCell.id ? order : 'asc'}
                  onClick={createSortHandler(headCell.id)}
                >
                  {headCell.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {players.map((player) => (
            <TableRow key={player.player_id} hover>
              <TableCell component="th" scope="row" sx={{ fontWeight: 'medium' }}>
                {player.first_name} {player.last_name}
              </TableCell>
              <TableCell>
                <Chip 
                  label={player.position} 
                  color={
                    player.position === 'QB' ? 'error' :
                    player.position === 'RB' ? 'success' :
                    player.position === 'WR' ? 'info' :
                    player.position === 'TE' ? 'warning' : 'default'
                  }
                  size="small" 
                  variant="outlined"
                />
              </TableCell>
              <TableCell>{player.team}</TableCell>
              
              <TableCell align="right">{player.stats?.pts_std?.toFixed(1) || '-'}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                {player.stats?.pts_half_ppr?.toFixed(1) || '-'}
              </TableCell>
              <TableCell align="right">{player.stats?.pts_ppr?.toFixed(1) || '-'}</TableCell>
              <TableCell align="right">{player.stats?.gp || '-'}</TableCell>
            </TableRow>
          ))}
          {players.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                <Typography variant="body1" color="text.secondary">
                  No players found matching your filters.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
