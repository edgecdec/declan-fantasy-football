'use client';

import * as React from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Box,
  Chip,
  SelectChangeEvent
} from '@mui/material';

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
  PaperProps: {
    style: {
      maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
      width: 250,
    },
  },
};

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (newValue: string[]) => void;
  minWidth?: number;
  maxWidth?: number;
}

export default function MultiSelectFilter({ 
  label, 
  options, 
  value, 
  onChange,
  minWidth = 150,
  maxWidth = 300
}: MultiSelectFilterProps) {
  
  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const {
      target: { value: newValue },
    } = event;
    
    // On autofill we get a stringified value.
    onChange(typeof newValue === 'string' ? newValue.split(',') : newValue);
  };

  return (
    <FormControl size="small" sx={{ minWidth, maxWidth }}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={value}
        onChange={handleChange}
        input={<OutlinedInput label={label} />}
        renderValue={(selected) => (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {selected.map((val) => (
              <Chip key={val} label={val} size="small" />
            ))}
          </Box>
        )}
        MenuProps={MenuProps}
      >
        {options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
