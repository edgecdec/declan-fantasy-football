'use client';

import * as React from 'react';
import { Box, Modal, Paper, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SmartTable from '@/components/common/SmartTable';
import { getPositionColor } from '@/constants/colors';
import StartsTooltip from '@/components/performance/StartsTooltip';

interface ImpactsModalProps {
  data: any[] | null;
  onClose: () => void;
}

export default function ImpactsModal({ data, onClose }: ImpactsModalProps) {
  return (
    <Modal open={!!data} onClose={onClose} aria-labelledby="all-impacts-modal">
      <Paper sx={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '90%', maxWidth: 800, bgcolor: 'background.paper', boxShadow: 24, p: 4,
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" component="h2">Player Impact Details</Typography>
          <IconButton onClick={onClose}><CloseIcon /></IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Cumulative Points Over League Average (POLA).
        </Typography>
        <SmartTable
          data={data || []}
          keyField="playerId"
          defaultSortBy="totalPOLA"
          defaultSortOrder="desc"
          rowsPerPageOptions={[10, 25, 50, 100, 250, 500, 1000]}
          columns={[
            { id: 'name', label: 'Player', numeric: false, sortable: true, filterVariant: 'text' },
            {
              id: 'position', label: 'Pos', numeric: false, sortable: true, filterVariant: 'multi-select', width: 80,
              render: (row: any) => (
                <Box component="span" sx={{ color: getPositionColor(row.position), fontWeight: 'bold' }}>{row.position}</Box>
              )
            },
            {
              id: 'weeks', label: 'Starts', numeric: true, sortable: true,
              render: (row: any) => <StartsTooltip weeksStarted={row.weeksStarted || row.weeks} startedWeeks={row.startedWeeks} />
            },
            {
              id: 'totalPOLA', label: 'Total Impact', numeric: true, sortable: true,
              render: (row: any) => (
                <Box sx={{ color: row.totalPOLA > 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                  {row.totalPOLA > 0 ? '+' : ''}{row.totalPOLA.toFixed(1)}
                </Box>
              )
            },
            {
              id: 'avgPOLA', label: 'Avg Impact/Wk', numeric: true, sortable: true,
              render: (row: any) => (
                <Box sx={{ color: 'text.secondary' }}>{row.avgPOLA > 0 ? '+' : ''}{row.avgPOLA.toFixed(1)}</Box>
              )
            }
          ]}
        />
      </Paper>
    </Modal>
  );
}
