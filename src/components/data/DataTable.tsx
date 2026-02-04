import clsx from 'clsx';
import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

type SortDirection = 'asc' | 'desc' | null;

type Column<T> = {
  key: keyof T | string;
  header: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  render?: (item: T) => ReactNode;
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
};

type ControlledSort = {
  sortColumn: string | null;
  sortDirection: SortDirection;
  onSortChange: (column: string | null, direction: SortDirection) => void;
};

type DataTableProps<T> = {
  data: T[];
  columns: Column<T>[];
  emptyMessage?: string;
  dense?: boolean;
  noHorizontalScroll?: boolean;
  tableId?: string;
  defaultSortColumn?: string;
  defaultSortDirection?: SortDirection;
  /** When set, parent controls sort; data is not sorted inside DataTable (e.g. for server-side or full-dataset sort) */
  controlledSort?: ControlledSort;
};

export function DataTable<T extends object>({
  data,
  columns,
  emptyMessage = 'No records found',
  dense,
  noHorizontalScroll = false,
  tableId,
  defaultSortColumn,
  defaultSortDirection = null,
  controlledSort
}: DataTableProps<T>) {
  const getInitialSortState = (): { column: string | null; direction: SortDirection } => {
    if (tableId) {
      try {
        const stored = localStorage.getItem(`datatable-sort-${tableId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          return {
            column: parsed.column || null,
            direction: parsed.direction || null
          };
        }
      } catch {
        // Ignore parse errors
      }
    }
    if (defaultSortColumn && defaultSortDirection) {
      return { column: defaultSortColumn, direction: defaultSortDirection };
    }
    return { column: null, direction: null };
  };

  const initialSort = getInitialSortState();
  const [sortColumn, setSortColumn] = useState<string | null>(initialSort.column);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSort.direction);

  const effectiveSortColumn = controlledSort ? controlledSort.sortColumn : sortColumn;
  const effectiveSortDirection = controlledSort ? controlledSort.sortDirection : sortDirection;

  const handleSort = (columnKey: string) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column || column.sortable === false) return;

    const currentColumn = controlledSort ? controlledSort.sortColumn : sortColumn;
    const currentDirection = controlledSort ? controlledSort.sortDirection : sortDirection;

    let newColumn: string | null;
    let newDirection: SortDirection;

    if (currentColumn === columnKey) {
      if (currentDirection === 'asc') {
        newDirection = 'desc';
        newColumn = columnKey;
      } else if (currentDirection === 'desc') {
        newDirection = null;
        newColumn = null;
      } else {
        newDirection = 'asc';
        newColumn = columnKey;
      }
    } else {
      newColumn = columnKey;
      // Start with desc (descending) for rate columns on first click
      const isRateColumn = columnKey.toLowerCase().includes('rate') || 
                          columnKey.toLowerCase().includes('latency') ||
                          columnKey === 'docCountNum' ||
                          columnKey === 'totalSizeBytes';
      newDirection = isRateColumn ? 'desc' : 'asc';
    }

    if (controlledSort) {
      controlledSort.onSortChange(newColumn, newDirection);
    } else {
      setSortColumn(newColumn);
      setSortDirection(newDirection);
      if (tableId) {
        try {
          localStorage.setItem(
            `datatable-sort-${tableId}`,
            JSON.stringify({ column: newColumn, direction: newDirection })
          );
        } catch {
          // Ignore
        }
      }
    }
  };

  const sortedData = useMemo(() => {
    if (controlledSort) return data;
    if (!sortColumn || !sortDirection) return data;

    const column = columns.find((col) => col.key === sortColumn);
    if (!column) return data;

    return [...data].sort((a, b) => {
      if (column.sortFn) {
        return sortDirection === 'asc' ? column.sortFn(a, b) : column.sortFn(b, a);
      }

      const aValue = a[column.key as keyof T];
      const bValue = b[column.key as keyof T];

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }

      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      
      if (sortDirection === 'asc') {
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
      } else {
        return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
      }
    });
  }, [data, sortColumn, sortDirection, columns, controlledSort]);

  const getSortIcon = (columnKey: string) => {
    if (effectiveSortColumn !== columnKey) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    }
    if (effectiveSortDirection === 'asc') {
      return <ArrowUp className="h-3 w-3" />;
    }
    if (effectiveSortDirection === 'desc') {
      return <ArrowDown className="h-3 w-3" />;
    }
    return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  };

  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className={clsx('relative overflow-y-visible', noHorizontalScroll ? 'overflow-x-hidden' : 'overflow-x-auto')}>
        <table className={clsx('w-full text-left', dense ? 'text-xs' : 'text-sm')}>
          <thead>
            <tr className="border-b-2 border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
              {columns.map((column) => {
                const isSortable = column.sortable !== false;
                const isSorted = effectiveSortColumn === column.key;
                
                return (
                  <th
                    key={column.key as string}
                    className={clsx(
                      'px-3 py-2.5 font-bold text-gray-900 dark:text-gray-50',
                      dense ? 'text-xs' : 'text-sm',
                      column.className,
                      {
                        'text-left': column.align === 'left' || !column.align,
                        'text-center': column.align === 'center',
                        'text-right': column.align === 'right',
                        'cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700': isSortable,
                        'bg-blue-50 dark:bg-blue-900/20': isSorted
                      }
                    )}
                    onClick={() => isSortable && handleSort(column.key as string)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{column.header}</span>
                      {isSortable && (
                        <span className="flex-shrink-0">
                          {getSortIcon(column.key as string)}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-4 text-center text-gray-500 dark:text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((item, rowIndex) => (
                <tr
                  key={`${item[columns[0].key as keyof T]}-${rowIndex}`}
                  className="border-b border-gray-200 text-gray-800 transition hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                >
                  {columns.map((column) => (
                    <td
                      key={`${column.key as string}-${rowIndex}`}
                      className={clsx(
                        dense ? 'px-2 py-1.5' : 'px-3 py-2',
                        column.className,
                        {
                          'text-left': column.align === 'left' || !column.align,
                          'text-center': column.align === 'center',
                          'text-right': column.align === 'right'
                        }
                      )}
                    >
                      {column.render
                        ? column.render(item)
                        : (item[column.key as keyof T] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

