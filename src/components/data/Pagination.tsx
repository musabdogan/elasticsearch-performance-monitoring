import { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** When true, render inline (no border/background) for use in header row */
  inline?: boolean;
}

const Pagination = memo<PaginationProps>(function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  inline = false
}) {
  if (totalPages <= 1 && totalItems <= pageSize) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={inline ? 'flex items-center gap-2' : 'flex items-center justify-between gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-600 dark:bg-gray-800/50'}>
      {!inline && (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {totalItems === 0
            ? '0 items'
            : `${start}-${end} of ${totalItems}`}
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="inline-flex items-center justify-center rounded p-1.5 text-gray-600 transition hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none dark:text-gray-300 dark:hover:bg-gray-700"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4rem] text-center text-xs font-medium text-gray-700 dark:text-gray-300">
          Page {currentPage} of {totalPages || 1}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="inline-flex items-center justify-center rounded p-1.5 text-gray-600 transition hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none dark:text-gray-300 dark:hover:bg-gray-700"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

export default Pagination;
