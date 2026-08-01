'use client';

import * as React from 'react';
import { Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Divider, IconButton, Snackbar, Alert, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useCustomRankings } from '@/context/CustomRankingsContext';
import { describeDynastyVariant, describeRedraftVariant } from '@/services/draft/rankingsVariant';

export default function RankingsSelector() {
  const {
    rankingSets, activeId, activeName,
    dynastyVariant, dynastyLoading,
    redraftVariant, redraftLoading,
    uploadCsv, selectRankingSet, deleteRankingSet,
  } = useCustomRankings();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState<{ severity: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadCsv(file);
      const unmatchedNote = result.unmatchedNames.length > 0 ? ` (${result.unmatchedNames.length} unmatched)` : '';
      setSnackbar({ severity: 'success', message: `Matched ${result.matchedCount}/${result.totalRows} players${unmatchedNote}.` });
    } catch (err) {
      setSnackbar({ severity: 'error', message: err instanceof Error ? err.message : 'Failed to parse CSV.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      <Button
        size="small"
        variant="outlined"
        endIcon={<ExpandMoreIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ textTransform: 'none', maxWidth: 200 }}
      >
        <Typography variant="caption" noWrap>{activeName}</Typography>
      </Button>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem
          selected={activeId === 'default'}
          onClick={() => { selectRankingSet('default'); setAnchorEl(null); }}
        >
          <ListItemIcon>{activeId === 'default' && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>
            Default Rankings
            <Typography variant="caption" color="text.secondary" display="block">
              {redraftLoading ? 'Loading…' : describeRedraftVariant(redraftVariant)}
            </Typography>
          </ListItemText>
        </MenuItem>

        <MenuItem
          selected={activeId === 'dynasty'}
          onClick={() => { selectRankingSet('dynasty'); setAnchorEl(null); }}
        >
          <ListItemIcon>{activeId === 'dynasty' && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>
            Dynasty Rankings
            <Typography variant="caption" color="text.secondary" display="block">
              {dynastyLoading ? 'Loading…' : describeDynastyVariant(dynastyVariant)}
            </Typography>
          </ListItemText>
        </MenuItem>

        {rankingSets.length > 0 && <Divider />}

        {rankingSets.map(set => (
          <MenuItem
            key={set.id}
            selected={activeId === set.id}
            onClick={() => { selectRankingSet(set.id); setAnchorEl(null); }}
          >
            <ListItemIcon>{activeId === set.id && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>
              {set.name}
              <Typography variant="caption" color="text.secondary" display="block">
                {set.matchedCount}/{set.totalRows} matched
              </Typography>
            </ListItemText>
            <IconButton
              size="small"
              edge="end"
              sx={{ ml: 1 }}
              onClick={(e) => { e.stopPropagation(); deleteRankingSet(set.id); }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </MenuItem>
        ))}

        <Divider />

        <MenuItem onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{uploading ? 'Uploading…' : 'Upload CSV…'}</ListItemText>
        </MenuItem>
      </Menu>

      <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFileChange} />

      <Snackbar
        open={!!snackbar}
        autoHideDuration={5000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar ? (
          <Alert severity={snackbar.severity} onClose={() => setSnackbar(null)}>{snackbar.message}</Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
