import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Expand, GripVertical, RefreshCw, X, ArrowDown, ArrowUp } from 'lucide-react';
import { CodeBlockWithCopy } from '@/components/ui/CodeBlockWithCopy';
import { IndexDataFieldsPanel } from '@/components/index/IndexDataFieldsPanel';
import { DiscoverFieldsPanel } from '@/components/query/DiscoverFieldsPanel';
import { DISCOVER_SIDEBAR_WIDTH_CLASS } from '@/components/query/discoverLayout';
import { DiscoverFilterBar } from '@/components/query/DiscoverFilterBar';
import { DiscoverDocumentFlyout } from '@/components/query/DiscoverDocumentFlyout';
import {
  DiscoverCellActionPopover,
  DISCOVER_CELL_HOVER_DELAY_MS,
  DISCOVER_CELL_LEAVE_DELAY_MS,
  type DiscoverCellActionTarget
} from '@/components/query/DiscoverCellActionPopover';
import type { DiscoverFilter } from '@/types/discover';
import type { FieldTopValuesResult } from '@/types/discover';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { resolveFieldAggField } from '@/utils/fieldMappingTypes';
import { getConnectedElementRect } from '@/utils/anchoredPopoverPosition';
import { getDiscoverCellValue } from '@/utils/discoverCellValue';
import type { ClusterConnection } from '@/types/app';
import type { SearchHit } from '@/types/api';
import {
  parseFieldDragPayload,
  setFieldDragPayload,
  type FieldDragPayload
} from '@/hooks/useDocumentColumns';
import { DOCUMENT_PAGE_SIZE_OPTIONS, formatDocumentPageSizeTopLabel, formatDocumentTotalLabel } from '@/utils/indexSearchQuery';
import {
  downloadIndexDataCsv,
  downloadIndexDataJson,
  getHitColumnValue,
  META_FIELD_ID
} from '@/utils/indexDataTable';

function getConnectedAccountNote(cluster: ClusterConnection): string | null {
  const authType =
    cluster.authType ??
    (cluster.apiKey?.trim() ? 'apiKey' : cluster.username && cluster.password ? 'basic' : 'none');
  const username = cluster.username?.trim();

  if (authType === 'basic' && username) {
    return `This cluster is connected as ${username}. Add the role to that user in Kibana.`;
  }
  if (authType === 'apiKey') {
    return 'This cluster uses API key auth. Add the role to the API key owner (Stack Management → Security → API keys → Owner).';
  }
  if (authType === 'none') {
    return 'No credentials are stored for this cluster; assign the role to the Elasticsearch user you use here.';
  }
  return null;
}

const cellClass =
  'min-w-0 overflow-hidden px-2 py-2 font-mono text-sm text-gray-800 dark:text-gray-200';

type DiscoverCellHoverHandlers = {
  onCellPointerEnter: (field: string, hit: SearchHit, anchorEl: HTMLElement) => void;
  onCellPointerLeave: () => void;
};

const HitRow = memo(function HitRow({
  hit,
  fieldColumns,
  indexName,
  expanded,
  onToggle,
  discoverCellHover,
  showDocumentFlyout,
  documentFlyoutActive,
  onOpenDocument
}: {
  hit: SearchHit;
  fieldColumns: string[];
  indexName: string;
  expanded: boolean;
  onToggle: () => void;
  discoverCellHover?: DiscoverCellHoverHandlers;
  showDocumentFlyout?: boolean;
  documentFlyoutActive?: boolean;
  onOpenDocument?: () => void;
}) {
  const colSpan = Math.max(1, fieldColumns.length + (showDocumentFlyout ? 1 : 0));

  return (
    <Fragment>
      <tr
        className={`border-b border-gray-200/80 dark:border-gray-700/80 ${
          documentFlyoutActive
            ? 'bg-blue-50/70 dark:bg-blue-950/20'
            : expanded
              ? 'bg-blue-50/70 dark:bg-blue-950/20'
              : 'bg-white odd:bg-gray-50/40 hover:bg-gray-100/80 dark:bg-gray-900/30 dark:odd:bg-gray-900/50 dark:hover:bg-gray-800/60'
        } ${showDocumentFlyout ? '' : 'cursor-pointer'}`}
        onClick={showDocumentFlyout ? undefined : onToggle}
      >
        {showDocumentFlyout && (
          <td className="w-9 border-r border-gray-200/80 px-1 py-2 text-center dark:border-gray-700/80">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDocument?.();
              }}
              className={`inline-flex rounded p-1 text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100 ${
                documentFlyoutActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : ''
              }`}
              title="Inspect document"
              aria-label="Inspect document"
              aria-pressed={documentFlyoutActive}
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          </td>
        )}
        {fieldColumns.map((field) => {
          const cell = discoverCellHover
            ? getDiscoverCellValue(hit, field, indexName)
            : {
                display: getHitColumnValue(hit, field, indexName) || '—',
                copyText: '',
                filterValue: null as string | number | boolean | null
              };
          const title = getHitColumnValue(hit, field, indexName, 500);
          return (
            <td
              key={field}
              className={cellClass}
              title={discoverCellHover ? undefined : title}
            >
              <span
                className="block truncate"
                onMouseEnter={
                  discoverCellHover
                    ? (e) => {
                        discoverCellHover.onCellPointerEnter(field, hit, e.currentTarget);
                      }
                    : undefined
                }
                onMouseLeave={discoverCellHover ? () => discoverCellHover.onCellPointerLeave() : undefined}
              >
                {cell.display || '—'}
              </span>
            </td>
          );
        })}
      </tr>
      {!showDocumentFlyout && expanded && (
        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <td colSpan={colSpan} className="px-2 py-2">
            <CodeBlockWithCopy text={JSON.stringify(hit._source ?? hit, null, 2)} label="Document JSON" />
          </td>
        </tr>
      )}
    </Fragment>
  );
});

export type DocumentSearchPagination = {
  size: number;
  onSizeChange: (n: number) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export type DocumentSearchWorkspaceProps = {
  cluster: ClusterConnection;
  indexLabel: string;
  displayIndexName: string;
  hits: SearchHit[];
  from: number;
  queryKey: string;
  total: number | null;
  totalIsLowerBound?: boolean;
  took: number | null;
  page: number;
  totalPages: number | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  /** When true, hide the document table (e.g. time chart histogram-only mode). */
  hideDocumentResults?: boolean;
  searchSection?: ReactNode;
  pagination?: DocumentSearchPagination;
  availableFields: string[];
  selectedColumns: string[];
  dropTargetIndex: number | null;
  defaultsFromFieldUsage?: boolean;
  autoColumns?: boolean;
  onAutoColumnsChange?: (enabled: boolean) => void;
  setDropTargetIndex: (index: number | null) => void;
  toggleColumn: (field: string) => void;
  removeColumn: (field: string) => void;
  handleColumnDrop: (targetIndex: number, payload: FieldDragPayload) => void;
  handleDropAtEnd: (payload: FieldDragPayload) => void;
  resetToDefault: () => void;
  tableMaxHeight?: string;
  sortField?: string | null;
  sortOrder?: 'asc' | 'desc' | null;
  onColumnSort?: (field: string) => void;
  fieldsPanelVariant?: 'legacy' | 'discover';
  discoverHits?: SearchHit[];
  fieldUsageSummary?: FieldUsageSummary | null;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
  discoverFilters?: DiscoverFilter[];
  topValuesField?: string | null;
  topValuesAggField?: string | null;
  topValuesResult?: FieldTopValuesResult | null;
  topValuesLoading?: boolean;
  topValuesError?: string | null;
  onOpenDiscoverField?: (field: string, anchor: DOMRect) => void;
  onCloseTopValues?: () => void;
  onAddDiscoverFilter?: (
    field: string,
    aggField: string,
    value: string | number | boolean,
    negate: boolean
  ) => void;
  onRemoveDiscoverFilter?: (id: string) => void;
  onClearDiscoverFilters?: () => void;
  timeChart?: ReactNode;
  /** Split toolbar: index picker aligns with fields sidebar (Discover layout). */
  discoverToolbar?: {
    indexColumn: ReactNode;
    searchRow: ReactNode;
  };
};

export function DocumentSearchWorkspace({
  cluster,
  indexLabel,
  displayIndexName,
  hits,
  from,
  queryKey,
  total,
  totalIsLowerBound = false,
  took,
  page,
  totalPages,
  loading,
  error,
  forbidden,
  hideDocumentResults = false,
  searchSection,
  pagination,
  availableFields,
  selectedColumns,
  dropTargetIndex,
  defaultsFromFieldUsage = false,
  autoColumns = true,
  onAutoColumnsChange,
  setDropTargetIndex,
  toggleColumn,
  removeColumn,
  handleColumnDrop,
  handleDropAtEnd,
  resetToDefault,
  tableMaxHeight = 'max-h-[44vh]',
  sortField = null,
  sortOrder = null,
  onColumnSort,
  fieldsPanelVariant = 'legacy',
  discoverHits = [],
  fieldUsageSummary,
  mappings,
  discoverFilters = [],
  topValuesField = null,
  topValuesAggField = null,
  topValuesResult = null,
  topValuesLoading = false,
  topValuesError = null,
  onOpenDiscoverField,
  onCloseTopValues,
  onAddDiscoverFilter,
  onRemoveDiscoverFilter,
  onClearDiscoverFilters,
  timeChart,
  discoverToolbar
}: DocumentSearchWorkspaceProps) {
  const connectedAccountNote = useMemo(() => getConnectedAccountNote(cluster), [cluster]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [permissionHelpOpen, setPermissionHelpOpen] = useState(false);
  const [fieldFilter, setFieldFilter] = useState('');
  const [tableDragOver, setTableDragOver] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);
  const [showTookLoading, setShowTookLoading] = useState(false);
  const [cellActionTarget, setCellActionTarget] = useState<DiscoverCellActionTarget | null>(null);
  const cellHoverEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellHoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellActionAnchorRef = useRef<HTMLElement | null>(null);
  const cellPopoverHoverRef = useRef(false);
  const [documentFlyoutIndex, setDocumentFlyoutIndex] = useState<number | null>(null);
  const [documentFlyoutFieldSearch, setDocumentFlyoutFieldSearch] = useState('');
  const pendingDocNavRef = useRef<'first' | 'last' | null>(null);

  const discoverDocumentFlyoutEnabled = fieldsPanelVariant === 'discover';

  const clearCellHoverTimers = useCallback(() => {
    if (cellHoverEnterTimerRef.current != null) {
      window.clearTimeout(cellHoverEnterTimerRef.current);
      cellHoverEnterTimerRef.current = null;
    }
    if (cellHoverLeaveTimerRef.current != null) {
      window.clearTimeout(cellHoverLeaveTimerRef.current);
      cellHoverLeaveTimerRef.current = null;
    }
  }, []);

  const dismissCellActionPopover = useCallback(() => {
    clearCellHoverTimers();
    cellPopoverHoverRef.current = false;
    cellActionAnchorRef.current = null;
    setCellActionTarget(null);
  }, [clearCellHoverTimers]);

  const discoverCellHoverEnabled =
    fieldsPanelVariant === 'discover' && !!onAddDiscoverFilter;

  const handleCellPointerEnter = useCallback(
    (field: string, hit: SearchHit, anchorEl: HTMLElement) => {
      if (!discoverCellHoverEnabled || !onAddDiscoverFilter) return;
      clearCellHoverTimers();
      cellActionAnchorRef.current = anchorEl;
      const { filterValue, copyText } = getDiscoverCellValue(hit, field, displayIndexName);
      const aggField = resolveFieldAggField(field, fieldUsageSummary, mappings);

      cellHoverEnterTimerRef.current = window.setTimeout(() => {
        const el = cellActionAnchorRef.current;
        if (!el?.isConnected) return;
        setCellActionTarget({
          field,
          aggField,
          filterValue,
          copyText,
          getAnchorRect: () => getConnectedElementRect(cellActionAnchorRef.current)
        });
      }, DISCOVER_CELL_HOVER_DELAY_MS);
    },
    [
      clearCellHoverTimers,
      discoverCellHoverEnabled,
      fieldUsageSummary,
      displayIndexName,
      mappings,
      onAddDiscoverFilter
    ]
  );

  const handleCellPointerLeave = useCallback(() => {
    if (!discoverCellHoverEnabled) return;
    if (cellHoverEnterTimerRef.current != null) {
      window.clearTimeout(cellHoverEnterTimerRef.current);
      cellHoverEnterTimerRef.current = null;
    }
    cellHoverLeaveTimerRef.current = window.setTimeout(() => {
      if (!cellPopoverHoverRef.current) dismissCellActionPopover();
    }, DISCOVER_CELL_LEAVE_DELAY_MS);
  }, [discoverCellHoverEnabled, dismissCellActionPopover]);

  const handleCellPopoverPointerEnter = useCallback(() => {
    cellPopoverHoverRef.current = true;
    clearCellHoverTimers();
  }, [clearCellHoverTimers]);

  const handleCellPopoverPointerLeave = useCallback(() => {
    cellPopoverHoverRef.current = false;
    dismissCellActionPopover();
  }, [dismissCellActionPopover]);

  const discoverCellHover = useMemo<DiscoverCellHoverHandlers | undefined>(
    () =>
      discoverCellHoverEnabled
        ? {
            onCellPointerEnter: handleCellPointerEnter,
            onCellPointerLeave: handleCellPointerLeave
          }
        : undefined,
    [discoverCellHoverEnabled, handleCellPointerEnter, handleCellPointerLeave]
  );

  const discoverFiltersKey = useMemo(
    () => discoverFilters.map((f) => f.id).join(','),
    [discoverFilters]
  );

  useEffect(() => {
    dismissCellActionPopover();
    setDocumentFlyoutIndex(null);
  }, [queryKey, dismissCellActionPopover]);

  useEffect(() => {
    dismissCellActionPopover();
  }, [discoverFiltersKey, dismissCellActionPopover]);

  useEffect(() => {
    if (pendingDocNavRef.current === 'last' && hits.length > 0) {
      setDocumentFlyoutIndex(hits.length - 1);
      pendingDocNavRef.current = null;
    } else if (pendingDocNavRef.current === 'first' && hits.length > 0) {
      setDocumentFlyoutIndex(0);
      pendingDocNavRef.current = null;
    }
  }, [hits, queryKey]);

  useEffect(() => {
    if (documentFlyoutIndex == null) return;
    if (hits.length === 0) {
      setDocumentFlyoutIndex(null);
      return;
    }
    if (documentFlyoutIndex >= hits.length) {
      setDocumentFlyoutIndex(hits.length - 1);
    }
  }, [documentFlyoutIndex, hits.length]);

  const openDocumentFlyout = useCallback((index: number) => {
    setDocumentFlyoutIndex(index);
  }, []);

  const closeDocumentFlyout = useCallback(() => {
    setDocumentFlyoutIndex(null);
    setDocumentFlyoutFieldSearch('');
  }, []);

  const goFirstDocument = useCallback(() => {
    if (documentFlyoutIndex == null) return;
    if (documentFlyoutIndex > 0) setDocumentFlyoutIndex(0);
  }, [documentFlyoutIndex]);

  const goLastDocument = useCallback(() => {
    if (documentFlyoutIndex == null || hits.length === 0) return;
    setDocumentFlyoutIndex(hits.length - 1);
  }, [documentFlyoutIndex, hits.length]);

  const goPrevDocument = useCallback(() => {
    if (documentFlyoutIndex == null) return;
    if (documentFlyoutIndex > 0) {
      setDocumentFlyoutIndex(documentFlyoutIndex - 1);
      return;
    }
    if (pagination?.canPrev) {
      pendingDocNavRef.current = 'last';
      pagination.onPrev();
    }
  }, [documentFlyoutIndex, pagination]);

  const goNextDocument = useCallback(() => {
    if (documentFlyoutIndex == null) return;
    if (documentFlyoutIndex < hits.length - 1) {
      setDocumentFlyoutIndex(documentFlyoutIndex + 1);
      return;
    }
    if (pagination?.canNext) {
      pendingDocNavRef.current = 'first';
      pagination.onNext();
    }
  }, [documentFlyoutIndex, hits.length, pagination]);

  useEffect(() => {
    return () => clearCellHoverTimers();
  }, [clearCellHoverTimers]);

  useEffect(() => {
    if (!loading) {
      setShowTookLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowTookLoading(true), 400);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    setExpandedId(null);
  }, [hits, from, queryKey]);

  useEffect(() => {
    if (!downloadOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [downloadOpen]);

  const onTableDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setTableDragOver(true);
    setDropTargetIndex(selectedColumns.length);
  };

  const onTableDrop = (e: DragEvent) => {
    e.preventDefault();
    setTableDragOver(false);
    const payload = parseFieldDragPayload(e.dataTransfer);
    if (payload) handleDropAtEnd(payload);
  };

  const exportColumns = selectedColumns.length > 0 ? selectedColumns : [META_FIELD_ID];

  const handleDownloadCsv = useCallback(() => {
    downloadIndexDataCsv(hits, exportColumns, indexLabel, page);
    setDownloadOpen(false);
  }, [hits, exportColumns, indexLabel, page]);

  const handleDownloadJson = useCallback(() => {
    downloadIndexDataJson(hits, exportColumns, indexLabel, page);
    setDownloadOpen(false);
  }, [hits, exportColumns, indexLabel, page]);

  const showingEnd = from + hits.length;
  const totalLabel = formatDocumentTotalLabel(total, totalIsLowerBound);
  /** Show loading hint immediately when there are no results yet; otherwise defer 400ms to avoid flicker. */
  const showLoadingHint = loading && (showTookLoading || total == null);

  const onHeaderDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  };

  const onEndZoneDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(selectedColumns.length);
  };

  const showResultsPanel =
    !forbidden && !hideDocumentResults && (loading || hits.length > 0 || total != null);

  const useDiscoverShell = fieldsPanelVariant === 'discover' && discoverToolbar != null;
  const tableScrollClass = useDiscoverShell
    ? 'relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto'
    : `relative ${tableMaxHeight} overflow-x-hidden overflow-y-auto`;

  const fieldsSidebar =
    fieldsPanelVariant === 'discover' && onOpenDiscoverField && onCloseTopValues && onAddDiscoverFilter ? (
      <DiscoverFieldsPanel
        availableFields={availableFields}
        selectedColumns={selectedColumns}
        hits={discoverHits}
        fieldUsageSummary={fieldUsageSummary}
        mappings={mappings}
        defaultsFromFieldUsage={defaultsFromFieldUsage}
        autoColumns={autoColumns}
        onAutoColumnsChange={onAutoColumnsChange}
        onToggleField={toggleColumn}
        onReset={resetToDefault}
        activeFilters={discoverFilters}
        topValuesField={topValuesField}
        topValuesAggField={topValuesAggField}
        topValuesResult={topValuesResult}
        topValuesLoading={topValuesLoading}
        topValuesError={topValuesError}
        onOpenField={onOpenDiscoverField}
        onCloseTopValues={onCloseTopValues}
        onAddFilter={onAddDiscoverFilter}
      />
    ) : (
      <IndexDataFieldsPanel
        availableFields={availableFields}
        selectedColumns={selectedColumns}
        filter={fieldFilter}
        onFilterChange={setFieldFilter}
        onToggleField={toggleColumn}
        onReset={resetToDefault}
        defaultsFromFieldUsage={defaultsFromFieldUsage}
        autoColumns={autoColumns}
        onAutoColumnsChange={onAutoColumnsChange}
      />
    );

  const forbiddenBlock = forbidden ? (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
      <button
        type="button"
        onClick={() => setPermissionHelpOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2.5 text-left text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:bg-gray-700/50 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        {permissionHelpOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        Insufficient permissions for document read — How to add read privilege?
      </button>
      {permissionHelpOpen && (
        <div className="border-t border-gray-200 bg-gray-50/50 px-3 pb-3 pt-2 dark:border-gray-600 dark:bg-gray-800/30">
          <p className="mb-1.5 text-xs font-medium text-gray-900 dark:text-gray-100">What is required</p>
          <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <p>
              Document browse needs index-level <code className="rounded bg-gray-200 px-1 font-mono text-gray-800 dark:bg-gray-600 dark:text-gray-200">read</code>{' '}
              on the target index.
            </p>
            <p>
              Add the built-in <code className="rounded bg-gray-200 px-1 font-mono text-gray-800 dark:bg-gray-600 dark:text-gray-200">viewer</code> role
              via <span className="font-mono text-[11px]">Stack Management → Security → Users</span>.
            </p>
            {connectedAccountNote && <p>{connectedAccountNote}</p>}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const emptyState = (
    <>
      {loading && hits.length === 0 && !showResultsPanel && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          loading…
        </div>
      )}
      {!loading && !error && !forbidden && hits.length === 0 && !showResultsPanel && (
        <p className="text-sm text-gray-500">No documents found.</p>
      )}
    </>
  );

  const resultsMainColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {discoverFilters.length > 0 && onRemoveDiscoverFilter && (
        <div className="shrink-0 border-b border-gray-200 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900/30">
          <DiscoverFilterBar
            filters={discoverFilters}
            onRemove={onRemoveDiscoverFilter}
            onClearAll={onClearDiscoverFilters}
          />
        </div>
      )}
      {timeChart ? (
        <div className="shrink-0 border-b border-gray-200 bg-white px-2 py-2 dark:border-gray-700 dark:bg-gray-900/30">
          {timeChart}
        </div>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="border-b-2 border-blue-600 pb-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Documents ({totalLabel})
          </span>
          {showLoadingHint ? (
            <span className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
              loading…
            </span>
          ) : took != null ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">{took} ms</span>
          ) : null}
          {hits.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {from + 1}–{showingEnd}
            </span>
          )}
        </div>
        {pagination && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
            {totalPages != null && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={pagination.onPrev}
                  disabled={!pagination.canPrev || loading}
                  className="inline-flex items-center justify-center rounded p-1 text-gray-600 transition hover:bg-gray-200 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[6.5rem] text-center font-medium tabular-nums text-gray-700 dark:text-gray-300">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={pagination.onNext}
                  disabled={!pagination.canNext || loading}
                  className="inline-flex items-center justify-center rounded p-1 text-gray-600 transition hover:bg-gray-200 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="relative">
              <select
                id="document-page-size"
                value={pagination.size}
                onChange={(e) => pagination.onSizeChange(Number(e.target.value))}
                disabled={loading}
                aria-label="Results per page"
                className="appearance-none rounded-md border border-gray-300 bg-transparent py-1.5 pl-3 pr-8 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
              >
                {DOCUMENT_PAGE_SIZE_OPTIONS.map(({ value }) => (
                  <option key={value} value={value}>
                    {formatDocumentPageSizeTopLabel(value)}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                aria-hidden
              />
            </div>
          </div>
        )}
      </div>
      <div
        className={tableScrollClass}
        onDragOver={onTableDragOver}
        onDrop={onTableDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setTableDragOver(false);
            setDropTargetIndex(null);
          }
        }}
      >
        {tableDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-gray-400/80 bg-gray-900/5 dark:border-gray-500 dark:bg-gray-950/30">
            <span className="rounded bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm dark:bg-gray-800/90 dark:text-gray-200">
              Drop field here
            </span>
          </div>
        )}
        <table className="w-full table-fixed border-collapse text-left">
          {selectedColumns.length > 0 ? (
            <colgroup>
              {discoverDocumentFlyoutEnabled ? <col className="w-9" /> : null}
              {selectedColumns.map((col) => (
                <col key={col} />
              ))}
              <col className="w-6" />
            </colgroup>
          ) : null}
          <thead className="sticky top-0 z-10 bg-gray-200/95 text-xs tracking-wide text-gray-700 dark:bg-gray-700/95 dark:text-gray-200">
            <tr>
              {selectedColumns.length === 0 ? (
                <th
                  onDragOver={onEndZoneDragOver}
                  onDrop={onTableDrop}
                  className={`border-r border-gray-300/60 px-3 py-6 text-center font-normal normal-case dark:border-gray-600/60 ${
                    tableDragOver || dropTargetIndex === 0
                      ? 'bg-gray-300/80 dark:bg-gray-600/80'
                      : 'text-gray-500'
                  }`}
                >
                  Drop fields here to build the table
                </th>
              ) : (
                <>
                  {discoverDocumentFlyoutEnabled && (
                    <th
                      className="w-9 border-r border-gray-300/60 px-1 py-2 font-normal normal-case dark:border-gray-600/60"
                      aria-label="Inspect document"
                    />
                  )}
                  {selectedColumns.map((col, index) => (
                    <th
                      key={col}
                      draggable
                      onDragStart={(e) => {
                        setFieldDragPayload(e.dataTransfer, {
                          field: col,
                          source: 'column',
                          fromIndex: index
                        });
                        e.dataTransfer.setData('text/plain', col);
                      }}
                      onDragOver={(e) => onHeaderDragOver(e, index)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setTableDragOver(false);
                        const payload = parseFieldDragPayload(e.dataTransfer);
                        if (payload) handleColumnDrop(index, payload);
                      }}
                      onDragEnd={() => {
                        setDropTargetIndex(null);
                        setTableDragOver(false);
                      }}
                      className={`group relative min-w-0 overflow-hidden border-r border-gray-300/60 px-2 py-2 font-semibold normal-case dark:border-gray-600/60 ${
                        dropTargetIndex === index ? 'bg-gray-300/80 dark:bg-gray-600/80' : ''
                      }`}
                    >
                      <div className="flex items-center gap-0.5 pr-4">
                        <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-gray-400 opacity-0 group-hover:opacity-100" />
                        {onColumnSort ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onColumnSort(col);
                            }}
                            className={`flex min-w-0 items-center gap-0.5 truncate rounded px-0.5 hover:bg-gray-300/60 dark:hover:bg-gray-600/60 ${
                              sortField === col ? 'text-blue-700 dark:text-blue-300' : ''
                            }`}
                            title={`Sort by ${col}`}
                          >
                            <span className="truncate">{col}</span>
                            {sortField === col && sortOrder === 'asc' ? (
                              <ArrowUp className="h-3 w-3 shrink-0" />
                            ) : null}
                            {sortField === col && sortOrder === 'desc' ? (
                              <ArrowDown className="h-3 w-3 shrink-0" />
                            ) : null}
                          </button>
                        ) : (
                          <span className="truncate">{col}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeColumn(col);
                        }}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 opacity-0 hover:bg-gray-300/80 hover:text-gray-800 group-hover:opacity-100 dark:hover:bg-gray-600 dark:hover:text-gray-100"
                        aria-label={`Remove column ${col}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                  <th
                    onDragOver={onEndZoneDragOver}
                    onDrop={onTableDrop}
                    className={`w-6 border-r border-gray-300/60 px-1 py-1.5 font-normal normal-case dark:border-gray-600/60 ${
                      dropTargetIndex === selectedColumns.length
                        ? 'bg-gray-300/80 dark:bg-gray-600/80'
                        : ''
                    }`}
                  />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {selectedColumns.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  Select fields from the left panel or drop them here
                </td>
              </tr>
            ) : hits.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, selectedColumns.length + (discoverDocumentFlyoutEnabled ? 1 : 0))}
                  className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {loading ? 'loading…' : 'No documents found.'}
                </td>
              </tr>
            ) : (
              hits.map((hit, hitIndex) => (
                <HitRow
                  key={`${hit._index ?? ''}-${hit._id}`}
                  hit={hit}
                  fieldColumns={selectedColumns}
                  indexName={displayIndexName}
                  expanded={expandedId === hit._id}
                  onToggle={() => setExpandedId((id) => (id === hit._id ? null : hit._id))}
                  discoverCellHover={discoverCellHover}
                  showDocumentFlyout={discoverDocumentFlyoutEnabled}
                  documentFlyoutActive={documentFlyoutIndex === hitIndex}
                  onOpenDocument={() => openDocumentFlyout(hitIndex)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
        <span className="min-w-0 flex-1">
          {hits.length} row{hits.length !== 1 ? 's' : ''}
          {selectedColumns.length > 0 ? ` · ${selectedColumns.length} columns` : ''}
          {availableFields.length > 0 ? ` · ${availableFields.length} fields` : ''}
        </span>
        <div className="relative shrink-0" ref={downloadRef}>
          <button
            type="button"
            onClick={() => setDownloadOpen((o) => !o)}
            disabled={hits.length === 0}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Download visible table"
            aria-expanded={downloadOpen}
          >
            <Download className="h-3 w-3" />
            Export
          </button>
          {downloadOpen && (
            <div className="absolute bottom-full right-0 z-30 mb-1 min-w-[120px] overflow-hidden rounded border border-gray-200 bg-white py-0.5 shadow-lg dark:border-gray-600 dark:bg-gray-800">
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="block w-full px-3 py-1.5 text-left text-[11px] text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="block w-full px-3 py-1.5 text-left text-[11px] text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                JSON
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const resultsPanel = showResultsPanel ? (
    <div
      className={
        useDiscoverShell
          ? 'flex min-h-0 flex-1 overflow-hidden'
          : 'flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'
      }
    >
      {fieldsSidebar}
      {resultsMainColumn}
    </div>
  ) : null;

  return (
    <>
      <div
        className={
          useDiscoverShell
            ? 'flex min-h-0 flex-1 flex-col text-sm'
            : 'space-y-3 text-sm'
        }
      >
        {useDiscoverShell ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40">
              <div
                className={`${DISCOVER_SIDEBAR_WIDTH_CLASS} min-w-0 border-r border-gray-200 px-2 py-1.5 dark:border-gray-700`}
              >
                {discoverToolbar!.indexColumn}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-2 py-1.5">
                {discoverToolbar!.searchRow}
              </div>
            </div>
            {searchSection ? (
              <div className="shrink-0 border-b border-gray-200 px-2 py-2 dark:border-gray-700">{searchSection}</div>
            ) : null}
            {forbiddenBlock}
            {error && !forbidden ? (
              <p className="shrink-0 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            {!forbidden && (resultsPanel ?? <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-8">{emptyState}</div>)}
          </div>
        ) : (
          <>
            {searchSection}
            {forbiddenBlock}
            {error && !forbidden && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {emptyState}
            {resultsPanel}
          </>
        )}
      </div>
      {discoverDocumentFlyoutEnabled && documentFlyoutIndex != null && hits[documentFlyoutIndex] && (
        <DiscoverDocumentFlyout
          hit={hits[documentFlyoutIndex]}
          documentNumber={from + documentFlyoutIndex + 1}
          total={total}
          totalIsLowerBound={totalIsLowerBound}
          indexName={displayIndexName}
          mappings={mappings}
          canGoFirst={documentFlyoutIndex > 0}
          canGoPrev={documentFlyoutIndex > 0 || !!pagination?.canPrev}
          canGoNext={documentFlyoutIndex < hits.length - 1 || !!pagination?.canNext}
          canGoLast={hits.length > 0 && documentFlyoutIndex < hits.length - 1}
          onFirst={goFirstDocument}
          onPrev={goPrevDocument}
          onNext={goNextDocument}
          onLast={goLastDocument}
          onClose={closeDocumentFlyout}
          fieldSearch={documentFlyoutFieldSearch}
          onFieldSearchChange={setDocumentFlyoutFieldSearch}
        />
      )}
      {cellActionTarget && onAddDiscoverFilter && (
        <DiscoverCellActionPopover
          target={cellActionTarget}
          activeFilters={discoverFilters}
          onAddFilter={(field, aggField, value, negate) => {
            dismissCellActionPopover();
            onAddDiscoverFilter(field, aggField, value, negate);
          }}
          onDismiss={dismissCellActionPopover}
          onPopoverPointerEnter={handleCellPopoverPointerEnter}
          onPopoverPointerLeave={handleCellPopoverPointerLeave}
        />
      )}
    </>
  );
}
