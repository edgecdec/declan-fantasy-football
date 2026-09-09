'use client';

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Paper,
  Box,
  Typography,
  Collapse,
  IconButton,
  Tooltip
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { ALL_ROWS, Order, SortableColumn, getComparator, pageSlice } from './tableSort';

// --- Types ---

export type { Order };

export interface Column<T> extends SortableColumn<T> {
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => React.ReactNode;
  /** Optional header tooltip, so a derived column can explain what it means. */
  tooltip?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyField: keyof T | ((row: T) => string); 
  defaultSortBy?: string;
  defaultSortOrder?: Order;
  /**
   * Page sizes offered. An "All" entry is appended automatically, so callers never have to
   * remember it and no table is stuck at a page size.
   */
  rowsPerPageOptions?: number[];
  /** Pass ALL_ROWS to open unpaginated. */
  defaultRowsPerPage?: number;
  onRowClick?: (row: T) => void;
  noDataMessage?: string;
  renderDetailPanel?: (row: T) => React.ReactNode; // New prop for expansion
}

// --- Inner Row Component ---
// (Needed to manage 'open' state per row)
function Row<T>({ 
  row, 
  index,
  columns, 
  keyField, 
  renderDetailPanel 
}: { 
  row: T, 
  index: number,
  columns: Column<T>[], 
  keyField: keyof T | ((row: T) => string), 
  renderDetailPanel?: (row: T) => React.ReactNode 
}) {
  const [open, setOpen] = React.useState(false);
  const key = typeof keyField === 'function' ? keyField(row) : (row as any)[keyField] as string;

  return (
    <React.Fragment>
      <TableRow
        hover
        onClick={() => renderDetailPanel && setOpen(!open)}
        sx={{
          cursor: renderDetailPanel ? 'pointer' : 'default',
          // Only strip the separator when a detail panel follows, so the row and its panel read
          // as one block. Applied unconditionally it removed the separator from every table on
          // the site -- and INCONSISTENTLY: `unset` on the border-bottom shorthand has the same
          // specificity as MuiTableCell's own rule, so which one won depended on Emotion's
          // style-injection order, leaving a stray rule under one or two columns per row.
          ...(renderDetailPanel ? { '& > *': { borderBottom: 'none' } } : {}),
        }}
      >
        {renderDetailPanel && (
          <TableCell width={50}>
            <IconButton
              aria-label="expand row"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!open);
              }}
            >
              {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </TableCell>
        )}
        
        {columns.map((column) => {
          let value: any = row;
          if (column.id.includes('.')) {
            const keys = column.id.split('.');
            for (const k of keys) value = value?.[k];
          } else {
            value = (row as any)[column.id];
          }

          return (
            <TableCell 
              key={column.id} 
              align={column.align || (column.numeric ? 'right' : 'left')}
            >
              {column.render ? column.render(row) : value}
            </TableCell>
          );
        })}
      </TableRow>
      
      {renderDetailPanel && (
        <TableRow>
          <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={columns.length + 1}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ margin: 2 }}>
                {renderDetailPanel(row)}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

// --- Main Component ---

export default function DataTable<T>({
  data,
  columns,
  keyField,
  defaultSortBy,
  defaultSortOrder = 'asc',
  rowsPerPageOptions = [25, 50, 100, 250],
  defaultRowsPerPage = 25,
  noDataMessage = "No data found.",
  renderDetailPanel
}: DataTableProps<T>) {
  const [order, setOrder] = React.useState<Order>(defaultSortOrder);
  const [orderBy, setOrderBy] = React.useState<string>(defaultSortBy || columns[0]?.id || '');
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(defaultRowsPerPage);

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const visibleRows = React.useMemo(() => {
    const sorted = [...data].sort(getComparator(order, orderBy, columns));
    return pageSlice(sorted, page, rowsPerPage);
  }, [data, order, orderBy, page, rowsPerPage, columns]);

  // Every table can be shown unpaginated. Appended here rather than at each call site so it
  // is always available and never duplicated if a caller already asked for it.
  const pageSizeOptions = React.useMemo(
    () => [
      ...rowsPerPageOptions.filter(n => n !== ALL_ROWS),
      { label: 'All', value: ALL_ROWS },
    ],
    [rowsPerPageOptions],
  );

  React.useEffect(() => {
    if (page > 0 && data.length < page * rowsPerPage) {
      setPage(0);
    }
  }, [data.length]);

  return (
    <Paper sx={{ width: '100%', mb: 2 }}>
      <TableContainer>
        <Table sx={{ minWidth: 750 }} size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'background.default' }}>
              {renderDetailPanel && <TableCell width={50} />}
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align || (column.numeric ? 'right' : 'left')}
                  sortDirection={orderBy === column.id ? order : false}
                  sx={{ fontWeight: 'bold', width: column.width, whiteSpace: 'nowrap' }}
                >
                  {(() => {
                    const heading = column.sortable !== false ? (
                      <TableSortLabel
                        active={orderBy === column.id}
                        direction={orderBy === column.id ? order : 'asc'}
                        onClick={() => handleRequestSort(column.id)}
                      >
                        {column.label}
                      </TableSortLabel>
                    ) : (
                      <span>{column.label}</span>
                    );
                    // Wrapped rather than replaced, so a column can be both sortable and
                    // explained — a derived column usually needs to be both.
                    return column.tooltip
                      ? <Tooltip title={column.tooltip} arrow>{heading}</Tooltip>
                      : heading;
                  })()}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.map((row, index) => (
              <Row 
                key={typeof keyField === 'function' ? keyField(row) : (row as any)[keyField] as string}
                row={row} 
                index={index}
                columns={columns}
                keyField={keyField}
                renderDetailPanel={renderDetailPanel}
              />
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + (renderDetailPanel ? 1 : 0)} align="center" sx={{ py: 3 }}>
                  <Typography variant="body1" color="text.secondary">
                    {noDataMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      
      {/* No pagination control when there is nothing to paginate. A "1-10 of 10" footer
          under a ten-row table is pure noise, and it is especially wrong on a small table
          nested inside an expanded row. */}
      {/* Keep the control whenever it can do something: either there is more data than fits,
          or the reader has switched to All and needs a way back. */}
      {(rowsPerPage === ALL_ROWS || data.length > rowsPerPage) && (
        <TablePagination
          rowsPerPageOptions={pageSizeOptions}
          component="div"
          count={data.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      )}
    </Paper>
  );
}