'use client';

import * as React from 'react';
import { FormControl, InputLabel, Select, MenuItem, CircularProgress } from '@mui/material';
import { SleeperService } from '@/services/sleeper/sleeperService';

type YearSelectorProps = {
  userId: string | undefined;
  selectedYear: string;
  onChange: (year: string) => void;
  minWidth?: number | string;
  disabled?: boolean;
};

export default function YearSelector({ 
  userId, 
  selectedYear, 
  onChange, 
  minWidth = 100,
  disabled = false 
}: YearSelectorProps) {
  const [years, setYears] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    const fetchSeasons = async () => {
      if (!userId) {
        // Fallback to basic range if no user
        const currentYear = new Date().getMonth() < 5 ? new Date().getFullYear() - 1 : new Date().getFullYear();
        const fallback = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
        if (mounted) setYears(fallback);
        return;
      }

      setLoading(true);
      try {
        const activeSeasons = await SleeperService.getActiveSeasons(userId);
        if (mounted && activeSeasons.length > 0) {
          setYears(activeSeasons);
          
          // Auto-select most recent if current selection is invalid
          if (!activeSeasons.includes(selectedYear)) {
            onChange(activeSeasons[0]);
          }
        }
      } catch (e) {
        console.error('Failed to fetch active seasons', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchSeasons();

    return () => { mounted = false; };
  }, [userId]);

  // Ensure selectedYear is in the list (or add it temporarily if loading/custom)
  const displayYears = React.useMemo(() => {
    if (years.includes(selectedYear)) return years;
    return [selectedYear, ...years].sort((a, b) => b.localeCompare(a));
  }, [years, selectedYear]);

  return (
    <FormControl sx={{ minWidth }} size="small">
      <InputLabel>Year</InputLabel>
      <Select
        value={selectedYear}
        label="Year"
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        startAdornment={loading ? <CircularProgress size={16} sx={{ mr: 1, ml: 1 }} /> : null}
      >
        {displayYears.map((y) => (
          <MenuItem key={y} value={y}>{y}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
