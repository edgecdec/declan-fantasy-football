'use client';

import * as React from 'react';
import { Paper, Box, Typography, Divider, Button } from '@mui/material';
import { getPositionColor } from '@/constants/colors';

export type PlayerImpact = {
  playerId: string;
  name: string;
  position: string;
  totalPOLA: number;
  weeksStarted?: number;
  weeks?: number;
  avgPOLA: number;
  ownerName?: string;
  ownerId?: string;
};

type Props = {
  impacts: PlayerImpact[];
  title?: string;
  onViewAll?: () => void;
  maxItems?: number;
  mode?: 'all' | 'carriers' | 'anchors';
};

export default function PlayerImpactList({ 
  impacts, 
  title, 
  onViewAll,
  maxItems = 4,
  mode = 'all'
}: Props) {
  // Sort just in case
  const sorted = [...impacts].sort((a, b) => b.totalPOLA - a.totalPOLA);
  const carriers = sorted.slice(0, maxItems);
  const anchors = [...sorted].reverse().slice(0, maxItems);

  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      {title && <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Players who gained/lost the most points vs position average.
      </Typography>}
      
      {(mode === 'all' || mode === 'carriers') && (
        <>
          <Typography variant="subtitle2" color="success.main" gutterBottom sx={{ mt: 2 }}>Top Legends (Carriers)</Typography>
          {carriers.map((p) => (
            <Box key={`${p.playerId}-${p.totalPOLA}`} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, p: 1, borderLeft: '4px solid #66bb6a', bgcolor: 'background.default' }}>
              <Box>
                <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.ownerName ? `${p.ownerName} • ` : ''}
                  <Box component="span" sx={{ color: getPositionColor(p.position), fontWeight: 'bold' }}>{p.position}</Box> • {p.weeksStarted || p.weeks} starts
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight="bold" color="#66bb6a">+{p.totalPOLA.toFixed(1)}</Typography>
                <Typography variant="caption" color="text.secondary">+{p.avgPOLA.toFixed(1)} / wk</Typography>
              </Box>
            </Box>
          ))}
        </>
      )}

      {(mode === 'all' && <Divider sx={{ my: 2 }} />)}

      {(mode === 'all' || mode === 'anchors') && (
        <>
          <Typography variant="subtitle2" color="error.main" gutterBottom>Biggest Busts (Anchors)</Typography>
          {anchors.map((p) => (
            <Box key={`${p.playerId}-${p.totalPOLA}`} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, p: 1, borderLeft: '4px solid #ef5350', bgcolor: 'background.default' }}>
              <Box>
                <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.ownerName ? `${p.ownerName} • ` : ''}
                  <Box component="span" sx={{ color: getPositionColor(p.position), fontWeight: 'bold' }}>{p.position}</Box> • {p.weeksStarted || p.weeks} starts
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight="bold" color="#ef5350">{p.totalPOLA.toFixed(1)}</Typography>
                <Typography variant="caption" color="text.secondary">{p.avgPOLA.toFixed(1)} / wk</Typography>
              </Box>
            </Box>
          ))}
        </>
      )}
      
      {onViewAll && (
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Button variant="outlined" size="small" onClick={onViewAll}>
            View Full List
          </Button>
        </Box>
      )}
    </Paper>
  );
}
