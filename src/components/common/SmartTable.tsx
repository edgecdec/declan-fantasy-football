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
}

// ... existing code ...

export default function SmartTable<T>({
  data,
  columns,
  keyField,
  defaultSortBy,
  defaultSortOrder,
  defaultRowsPerPage,
  enableGlobalSearch = true,
  renderDetailPanel
}: SmartTableProps<T>) {
  // ... existing code ...

      {/* Table */}
      <DataTable
        data={filteredData}
        columns={columns}
        keyField={keyField}
        defaultSortBy={defaultSortBy}
        defaultSortOrder={defaultSortOrder}
        defaultRowsPerPage={defaultRowsPerPage}
        renderDetailPanel={renderDetailPanel}
      />
    </Box>
  );
}