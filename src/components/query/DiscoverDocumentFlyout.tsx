import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Search,
  X
} from 'lucide-react';
import { CodeBlockWithCopy } from '@/components/ui/CodeBlockWithCopy';
import { useNestedEscapeClose } from '@/hooks/useNestedEscapeClose';
import type { SearchHit } from '@/types/api';
import { fieldTypeIconLabel, resolveMappingFieldType } from '@/utils/fieldMappingTypes';
import {
  filterDocumentFieldRows,
  flattenHitDocumentFields,
  type DiscoverDocumentFieldRow
} from '@/utils/discoverDocumentFields';
import { formatDocumentTotalLabel } from '@/utils/indexSearchQuery';

type DiscoverDocumentFlyoutProps = {
  hit: SearchHit;
  documentNumber: number;
  total: number | null;
  totalIsLowerBound?: boolean;
  indexName: string;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
  canGoFirst: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onClose: () => void;
  fieldSearch: string;
  onFieldSearchChange: (value: string) => void;
};

function FieldTypeBadge({
  field,
  mappings
}: {
  field: string;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
}) {
  const type = resolveMappingFieldType(field, mappings);
  const label = fieldTypeIconLabel(type);
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-[9px] font-bold text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      title={type}
    >
      {label}
    </span>
  );
}

function DocumentFieldTable({
  rows,
  mappings
}: {
  rows: DiscoverDocumentFieldRow[];
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        No fields match your search.
      </p>
    );
  }

  return (
    <table className="min-w-full border-collapse text-left text-sm">
      <thead className="sticky top-0 z-10 bg-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        <tr>
          <th className="w-8 border-b border-gray-200 px-2 py-2 dark:border-gray-700" aria-hidden />
          <th className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">Field</th>
          <th className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.field}
            className="border-b border-gray-100 odd:bg-white even:bg-gray-50/60 dark:border-gray-800 dark:odd:bg-gray-900/40 dark:even:bg-gray-900/20"
          >
            <td className="px-2 py-2 align-top">
              <FieldTypeBadge field={row.field} mappings={mappings} />
            </td>
            <td className="max-w-[10rem] px-3 py-2 align-top font-mono text-xs text-gray-800 dark:text-gray-200">
              <span className="break-all">{row.field}</span>
            </td>
            <td className="max-w-[14rem] px-3 py-2 align-top font-mono text-xs text-gray-700 dark:text-gray-300">
              <span className="break-all whitespace-pre-wrap">{row.value || '—'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiscoverDocumentFlyout({
  hit,
  documentNumber,
  total,
  totalIsLowerBound = false,
  indexName,
  mappings,
  canGoFirst,
  canGoPrev,
  canGoNext,
  canGoLast,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onClose,
  fieldSearch,
  onFieldSearchChange
}: DiscoverDocumentFlyoutProps) {
  const [activeTab, setActiveTab] = useState<'table' | 'json'>('table');

  useNestedEscapeClose(true, onClose);

  const allRows = useMemo(
    () => flattenHitDocumentFields(hit, indexName),
    [hit, hit._id, indexName]
  );
  const filteredRows = useMemo(
    () => filterDocumentFieldRows(allRows, fieldSearch),
    [allRows, fieldSearch]
  );
  const jsonText = useMemo(() => JSON.stringify(hit, null, 2), [hit]);
  const totalLabel = formatDocumentTotalLabel(total, totalIsLowerBound);

  const navButtonClass =
    'inline-flex items-center justify-center rounded p-1 text-gray-600 transition hover:bg-gray-200 disabled:pointer-events-none disabled:opacity-35 dark:text-gray-300 dark:hover:bg-gray-700';

  const panel = (
    <>
      <div
        className="fixed inset-0 z-[240] bg-black/25"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed bottom-14 left-0 top-14 z-[250] flex w-[min(32rem,calc(100vw-0.5rem))] flex-col border-r border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        role="dialog"
        aria-modal="true"
        aria-label="Document inspector"
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Document</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {documentNumber.toLocaleString()} of {totalLabel}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            <button type="button" className={navButtonClass} onClick={onFirst} disabled={!canGoFirst} aria-label="First document on page">
              <ChevronFirst className="h-4 w-4" />
            </button>
            <button type="button" className={navButtonClass} onClick={onPrev} disabled={!canGoPrev} aria-label="Previous document">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" className={navButtonClass} onClick={onNext} disabled={!canGoNext} aria-label="Next document">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" className={navButtonClass} onClick={onLast} disabled={!canGoLast} aria-label="Last document on page">
              <ChevronLast className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              aria-label="Close document inspector"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 px-3 dark:border-gray-700">
          {(['table', 'json'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-3 py-2 text-sm font-medium capitalize transition ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                  : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'table' && (
          <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={fieldSearch}
                onChange={(e) => onFieldSearchChange(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search field names or values"
                className="w-full rounded border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {activeTab === 'table' ? (
            <DocumentFieldTable key={hit._id} rows={filteredRows} mappings={mappings} />
          ) : (
            <div className="p-3">
              <CodeBlockWithCopy text={jsonText} label="document JSON" />
            </div>
          )}
        </div>
      </aside>
    </>
  );

  return createPortal(panel, document.body);
}
