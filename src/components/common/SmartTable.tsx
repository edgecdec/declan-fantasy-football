'use client';

import * as React from 'react';
import {
  Box,
  TextField,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Chip
} from '@mui/material';
import DataTable, { Column as BaseColumn } from './DataTable';
import MultiSelectFilter from './MultiSelectFilter';

// --- Types ---

// Extend the base column definition to include filtering options
export interface SmartColumn<T> extends BaseColumn<T> {
  filterVariant?: 'text' | 'select' | 'multi-select';
  filterOptions?: string[]; // If omitted, unique values will be derived from data
}

interface SmartTableProps<T> {
  data: T[];
  columns: SmartColumn<T>[];
  keyField: keyof T | ((row: T) => string);
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
  defaultRowsPerPage?: number;
  enableGlobalSearch?: boolean;
  renderDetailPanel?: (row: T) => React.ReactNode;
  noDataMessage?: string;
}

// --- Helper Functions ---

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => {
    return acc && acc[part] !== undefined ? acc[part] : null;
  }, obj);
}

// --- Component ---

export default function SmartTable<T>({
  data,
  columns,
  keyField,
  defaultSortBy,
  defaultSortOrder,
  defaultRowsPerPage,
  enableGlobalSearch = true,
  renderDetailPanel,
  noDataMessage
}: SmartTableProps<T>) {
  // State
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [columnFilters, setColumnFilters] = React.useState<Record<string, string[]>>({});

  // 1. Extract Filter Options (Memoized)
  const filterOptionsMap = React.useMemo(() => {
    const options: Record<string, string[]> = {};
    columns.forEach(col => {
      if (col.filterVariant === 'select' || col.filterVariant === 'multi-select') {
        if (col.filterOptions) {
          options[col.id] = col.filterOptions;
        } else {
          // Auto-derive unique values
          const unique = new Set<string>();
          data.forEach(row => {
            const val = getNestedValue(row, col.id);
            if (val) unique.add(String(val));
          });
          options[col.id] = Array.from(unique).sort();
        }
      }
    });
    return options;
  }, [data, columns]);

  // 2. Handle Filter Changes
  const handleColumnFilterChange = (columnId: string, value: string[]) => {
    setColumnFilters(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  // 3. Apply Filters
  const filteredData = React.useMemo(() => {
    return data.filter(row => {
      // A. Global Search
      if (globalFilter) {
        const searchText = globalFilter.toLowerCase();
        const matchesGlobal = columns.some(col => {
          const val = getNestedValue(row, col.id);
          return val ? String(val).toLowerCase().includes(searchText) : false;
        });
        if (!matchesGlobal) return false;
      }

      // B. Column Filters
      for (const col of columns) {
        if (!col.filterVariant) continue;
        
        const filterValue = columnFilters[col.id];
        if (!filterValue || filterValue.length === 0) continue;

        const rowValue = String(getNestedValue(row, col.id));

        if (col.filterVariant === 'text') {
           const searchText = (filterValue[0] || '').toLowerCase();
           if (searchText && !rowValue.toLowerCase().includes(searchText)) return false;
        }

        if (col.filterVariant === 'multi-select' || col.filterVariant === 'select') {
          if (!filterValue.includes(rowValue)) return false;
        }
      }

      return true;
    });
  }, [data, globalFilter, columnFilters, columns]);

  // --- Render ---

  return (
    <Box>
      {/* Filter Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          
          {/* Global Search */}
          {enableGlobalSearch && (
            <TextField
              label="Search..."
              variant="outlined"
              size="small"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              sx={{ minWidth: { xs: '100%', sm: 250 }, flexGrow: 1 }}
            />
          )}

          {/* Column Filters */}
          {columns.map(col => {
            if (!col.filterVariant) return null;
            
            const options = filterOptionsMap[col.id] || [];
            const selected = columnFilters[col.id] || [];

            if (col.filterVariant === 'multi-select') {
              return (
                <MultiSelectFilter
                  key={col.id}
                  label={col.label}
                  options={options}
                  value={selected}
                  onChange={(val) => handleColumnFilterChange(col.id, val)}
                  minWidth={150}
                />
              );
            }

            if (col.filterVariant === 'text') {
              return (
                <TextField
                  key={col.id}
                  label={`Filter ${col.label}`}
                  variant="outlined"
                  size="small"
                  value={selected[0] || ''}
                  onChange={(e) => handleColumnFilterChange(col.id, [e.target.value])}
                  sx={{ minWidth: 150 }}
                />
              );
            }

            // Fallback for single select (rarely used now, but kept for compatibility)
            return (
              <FormControl key={col.id} size="small" sx={{ minWidth: 150 }}>
                <InputLabel>{col.label}</InputLabel>
                <Select
                  value={selected[0] || ''}
                  onChange={(e) => handleColumnFilterChange(col.id, e.target.value ? [e.target.value] : [])}
                  input={<OutlinedInput label={col.label} />}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {options.map((opt) => (
                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
          })}
        </Box>
      </Paper>

      {/* Table */}
      <DataTable
        data={filteredData}
        columns={columns}
        keyField={keyField}
        defaultSortBy={defaultSortBy}
        defaultSortOrder={defaultSortOrder}
        defaultRowsPerPage={defaultRowsPerPage}
        renderDetailPanel={renderDetailPanel}
        noDataMessage={noDataMessage}
      />
    </Box>
  );
}
