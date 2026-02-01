'use client';

import * as React from 'react';
import { Paper, Box, TextField } from '@mui/material';
import MultiSelectFilter from '../common/MultiSelectFilter';

interface PlayerFilterBarProps {
  filterName: string;
  setFilterName: (val: string) => void;
  
  filterPos: string[];
  setFilterPos: (val: string[]) => void;
  
  filterTeam: string[];
  setFilterTeam: (val: string[]) => void;
  
  teamsList: string[];
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export default function PlayerFilterBar({
  filterName,
  setFilterName,
  filterPos,
  setFilterPos,
  filterTeam,
  setFilterTeam,
  teamsList
}: PlayerFilterBarProps) {
  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField 
          label="Search Player" 
          variant="outlined" 
          size="small"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        
        <MultiSelectFilter
          label="Positions"
          options={POSITIONS}
          value={filterPos}
          onChange={setFilterPos}
          minWidth={120}
        />

        <MultiSelectFilter
          label="Teams"
          options={teamsList}
          value={filterTeam}
          onChange={setFilterTeam}
          minWidth={120}
        />
      </Box>
    </Paper>
  );
}
