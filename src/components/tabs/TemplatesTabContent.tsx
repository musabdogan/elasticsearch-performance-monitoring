import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { getIndexTemplates, getLegacyTemplates, getNetworkErrorMessage } from '@/services/elasticsearch';
import type { IndexTemplateItem, LegacyTemplateListResponse } from '@/types/api';
import { DataTable } from '@/components/data/DataTable';
import Pagination from '@/components/data/Pagination';
import { InfoPopup } from '@/components/ui/InfoPopup';
import { TabSectionExpandTrigger } from '@/components/ui/TabSectionExpandTrigger';
import { RefreshCw, ChevronDown, ChevronRight, Copy, Check, X, Search } from 'lucide-react';
import { hasSearchTerms, matchesParsedTermsInAnyText, parseSearchTerms } from '@/utils/search';

const DEFAULT_PAGE_SIZE = 10;

const TEMPLATES_PERMISSION_MESSAGE =
  'Template list requires manage_index_templates (or view_index_metadata where supported).';

const TEMPLATES_KIBANA_SNIPPET = `POST _security/role/my_monitoring_role
{
  "cluster": ["manage_index_templates", "view_index_metadata"],
  "indices": []
}`;

function getTemplatesCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_PASSWORD "${base}/_index_template"`;
}

function CodeBlockWithCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative group">
      <pre className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 pr-10 text-xs font-mono whitespace-pre overflow-x-auto max-w-full tab-content-value">
        {text}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied!' : `Copy ${label}`}
        className="absolute top-2 right-2 p-1.5 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function getFieldPathsFromMappings(props: Record<string, unknown> | undefined, prefix = ''): string[] {
  if (!props || typeof props !== 'object') return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      paths.push(...getFieldPathsFromMappings(v.properties as Record<string, unknown>, fullPath));
    } else if (v.fields) {
      if (v.type) paths.push(fullPath);
      const fields = v.fields as Record<string, unknown>;
      for (const [fk, fv] of Object.entries(fields)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties) {
          paths.push(...getFieldPathsFromMappings(f.properties as Record<string, unknown>, `${fullPath}.${fk}`));
        } else {
          paths.push(`${fullPath}.${fk}`);
        }
      }
    } else if (v.type) {
      paths.push(fullPath);
    }
  }
  return paths;
}

export type LegacyTemplateRow = {
  name: string;
  index_patterns?: string[];
  order?: number;
  settings?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
  aliases?: Record<string, unknown>;
};
type SortDirection = 'asc' | 'desc' | null;

function legacyToList(data: LegacyTemplateListResponse): LegacyTemplateRow[] {
  return Object.entries(data).map(([name, t]) => ({ name, ...t }));
}

export function TemplatesTabContent({ onRefreshStateChange }: { onRefreshStateChange?: (loading: boolean) => void } = {}) {
  const { activeCluster, isClusterUnreachable } = useMonitoring();
  const activeClusterRef = useRef(activeCluster);
  activeClusterRef.current = activeCluster;
  const clusterKey = activeCluster ? `${activeCluster.label ?? ''}-${activeCluster.baseUrl}` : '';

  const [indexTemplates, setIndexTemplates] = useState<IndexTemplateItem[]>([]);
  const [legacyTemplates, setLegacyTemplates] = useState<LegacyTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [permissionHelpOpen, setPermissionHelpOpen] = useState(false);
  const [infoOpenComposable, setInfoOpenComposable] = useState(false);
  const [infoOpenLegacy, setInfoOpenLegacy] = useState(false);
  const [indexSearchTerm, setIndexSearchTerm] = useState('');
  const [legacySearchTerm, setLegacySearchTerm] = useState('');
  const [indexExpanded, setIndexExpanded] = useState(true);
  const [legacyExpanded, setLegacyExpanded] = useState(true);
  const [indexTemplatesPage, setIndexTemplatesPage] = useState(1);
  const [indexTemplatesPageSize, setIndexTemplatesPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [legacyTemplatesPage, setLegacyTemplatesPage] = useState(1);
  const [legacyTemplatesPageSize, setLegacyTemplatesPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [indexSortColumn, setIndexSortColumn] = useState<string | null>(null);
  const [indexSortDirection, setIndexSortDirection] = useState<SortDirection>(null);
  const [legacySortColumn, setLegacySortColumn] = useState<string | null>(null);
  const [legacySortDirection, setLegacySortDirection] = useState<SortDirection>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<{ type: 'index' | 'legacy'; name: string; body: unknown } | null>(null);
  const templateModalBackdropMouseDownRef = useRef(false);

  const toggleTemplateSection = useCallback((section: 'index' | 'legacy') => {
    if (section === 'index') {
      setIndexExpanded((prev) => {
        const next = !prev;
        if (next) setLegacyExpanded(false);
        return next;
      });
      return;
    }
    setLegacyExpanded((prev) => {
      const next = !prev;
      if (next) setIndexExpanded(false);
      return next;
    });
  }, []);

  const curlSnippet = getTemplatesCurlSnippet(activeCluster?.baseUrl ?? 'https://your-cluster:9200');

  const fetchTemplates = useCallback(async () => {
    const cluster = activeClusterRef.current;
    if (!cluster || isClusterUnreachable) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const [indexRes, legacyRes] = await Promise.allSettled([
        getIndexTemplates(cluster, signal),
        getLegacyTemplates(cluster, signal)
      ]);
      const indexTemplatesData = indexRes.status === 'fulfilled' ? (indexRes.value.index_templates ?? []) : [];
      const legacyTemplatesData = legacyRes.status === 'fulfilled' ? legacyToList(legacyRes.value) : [];
      setIndexTemplates(indexTemplatesData);
      setLegacyTemplates(legacyTemplatesData);
      if (indexRes.status === 'fulfilled' && legacyRes.status === 'fulfilled') {
        setError(null);
      } else if (indexRes.status === 'rejected' && legacyRes.status === 'rejected') {
        const msg =
          indexRes.status === 'rejected'
            ? indexRes.reason instanceof Error
              ? indexRes.reason.message
              : String(indexRes.reason)
            : '';
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
          setForbidden(true);
          setError(TEMPLATES_PERMISSION_MESSAGE);
        } else {
          const isTimeoutOrNetwork =
            msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
          setError(
            isTimeoutOrNetwork && cluster ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load templates')
          );
        }
      } else if (indexRes.status === 'rejected' || legacyRes.status === 'rejected') {
        const failed = indexRes.status === 'rejected' ? indexRes : legacyRes;
        const msg =
          failed.status === 'rejected' ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : '';
        if (!msg.includes('403') && !msg.toLowerCase().includes('forbidden')) {
          setError(msg.includes('400') ? 'Some template APIs not supported (OpenSearch or ES <7.9)' : `Partial load: ${msg}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        setForbidden(true);
        setError(TEMPLATES_PERMISSION_MESSAGE);
      } else {
        const isTimeoutOrNetwork =
          msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('network');
        setError(
          isTimeoutOrNetwork && cluster ? getNetworkErrorMessage(cluster.baseUrl) : (msg || 'Failed to load templates')
        );
      }
      setIndexTemplates([]);
      setLegacyTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [clusterKey, isClusterUnreachable]);

  useEffect(() => {
    if (clusterKey && !isClusterUnreachable) {
      setError(null);
      setIndexTemplates([]);
      setLegacyTemplates([]);
      setForbidden(false);
      setIndexTemplatesPage(1);
      setLegacyTemplatesPage(1);
      setIndexTemplatesPageSize(DEFAULT_PAGE_SIZE);
      setLegacyTemplatesPageSize(DEFAULT_PAGE_SIZE);
      setIndexSearchTerm('');
      setLegacySearchTerm('');
      setSelectedTemplate(null);
      fetchTemplates();
    } else {
      setIndexTemplates([]);
      setLegacyTemplates([]);
      setError(null);
      setForbidden(false);
    }
  }, [clusterKey, fetchTemplates, isClusterUnreachable]);

  useEffect(() => {
    setIndexTemplatesPage(1);
  }, [indexSearchTerm, indexTemplatesPageSize]);

  useEffect(() => {
    setLegacyTemplatesPage(1);
  }, [legacySearchTerm, legacyTemplatesPageSize]);

  useEffect(() => {
    const onRefresh = async () => {
      if (!activeCluster) return;
      onRefreshStateChange?.(true);
      try {
        await fetchTemplates();
      } finally {
        onRefreshStateChange?.(false);
      }
    };
    window.addEventListener('refreshTemplates', onRefresh);
    return () => window.removeEventListener('refreshTemplates', onRefresh);
  }, [activeCluster, isClusterUnreachable, fetchTemplates, onRefreshStateChange]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTemplate(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTemplate]);

  const filteredIndexTemplates = useMemo(() => {
    const parsed = parseSearchTerms(indexSearchTerm);
    if (!hasSearchTerms(parsed)) return indexTemplates;
    return indexTemplates.filter((t) => {
      const mappings = (t.index_template?.template as { mappings?: { properties?: Record<string, unknown> } })?.mappings
        ?.properties;
      const paths = getFieldPathsFromMappings(mappings);
      return matchesParsedTermsInAnyText(
        [
          t.name ?? '',
          ...(t.index_template?.index_patterns ?? []).map((p) => String(p)),
          ...paths
        ],
        parsed
      );
    });
  }, [indexTemplates, indexSearchTerm]);

  const filteredLegacyTemplates = useMemo(() => {
    const parsed = parseSearchTerms(legacySearchTerm);
    if (!hasSearchTerms(parsed)) return legacyTemplates;
    return legacyTemplates.filter((t) => {
      const paths = getFieldPathsFromMappings(t.mappings?.properties as Record<string, unknown>);
      return matchesParsedTermsInAnyText(
        [
          t.name ?? '',
          ...(t.index_patterns ?? []).map((p) => String(p)),
          ...paths
        ],
        parsed
      );
    });
  }, [legacyTemplates, legacySearchTerm]);

  const sortRows = useCallback(
    <T extends object>(
      rows: T[],
      columns: Array<{ key: keyof T | string; sortFn?: (a: T, b: T) => number }>,
      sortColumn: string | null,
      sortDirection: SortDirection
    ): T[] => {
      if (!sortColumn || !sortDirection) return rows;
      const column = columns.find((c) => c.key === sortColumn);
      if (!column) return rows;
      return [...rows].sort((a, b) => {
        if (column.sortFn) {
          return sortDirection === 'asc' ? column.sortFn(a, b) : column.sortFn(b, a);
        }
        const aValue = (a as Record<string, unknown>)[String(column.key)];
        const bValue = (b as Record<string, unknown>)[String(column.key)];
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        return sortDirection === 'asc'
          ? (aStr < bStr ? -1 : aStr > bStr ? 1 : 0)
          : (aStr > bStr ? -1 : aStr < bStr ? 1 : 0);
      });
    },
    []
  );

  const indexTemplateColumns = [
    {
      key: 'name' as const,
      header: 'Name',
      className: 'font-mono tab-content-value',
      sortable: true,
      render: (row: IndexTemplateItem) => (
        <button
          type="button"
          onClick={() =>
            setSelectedTemplate({
              type: 'index',
              name: row.name,
              body: row.index_template ?? {}
            })
          }
          className="text-left font-mono tab-content-value text-blue-600 dark:text-blue-400 hover:underline"
        >
          {row.name}
        </button>
      )
    },
    {
      key: 'index_patterns' as const,
      header: 'Index patterns',
      className: 'tab-content-value',
      sortable: true,
      sortFn: (a: IndexTemplateItem, b: IndexTemplateItem) => {
        const sa = (a.index_template?.index_patterns ?? []).join(', ');
        const sb = (b.index_template?.index_patterns ?? []).join(', ');
        return sa.localeCompare(sb);
      },
      render: (row: IndexTemplateItem) => (row.index_template?.index_patterns ?? []).join(', ') || '—'
    },
    {
      key: 'priority' as const,
      header: 'Priority',
      className: 'tab-content-value',
      sortable: true,
      sortFn: (a: IndexTemplateItem, b: IndexTemplateItem) => {
        const pa = Number(a.index_template?.priority) || 0;
        const pb = Number(b.index_template?.priority) || 0;
        return pa - pb;
      },
      render: (row: IndexTemplateItem) => row.index_template?.priority ?? '—'
    },
    {
      key: 'data_stream' as const,
      header: 'Data stream',
      className: 'tab-content-value',
      sortable: true,
      sortFn: (a: IndexTemplateItem, b: IndexTemplateItem) => {
        const da = a.index_template?.data_stream != null ? 1 : 0;
        const db = b.index_template?.data_stream != null ? 1 : 0;
        return da - db;
      },
      render: (row: IndexTemplateItem) => (row.index_template?.data_stream != null ? 'Yes' : '—')
    }
  ];

  const legacyTemplateColumns = [
    {
      key: 'name' as const,
      header: 'Name',
      className: 'font-mono tab-content-value',
      sortable: true,
      render: (row: LegacyTemplateRow) => (
        <button
          type="button"
          onClick={() =>
            setSelectedTemplate({
              type: 'legacy',
              name: row.name,
              body: {
                index_patterns: row.index_patterns,
                order: row.order,
                settings: row.settings,
                mappings: row.mappings,
                aliases: row.aliases
              }
            })
          }
          className="text-left font-mono tab-content-value text-blue-600 dark:text-blue-400 hover:underline"
        >
          {row.name}
        </button>
      )
    },
    {
      key: 'index_patterns' as const,
      header: 'Index patterns',
      className: 'tab-content-value',
      sortable: true,
      sortFn: (a: LegacyTemplateRow, b: LegacyTemplateRow) => {
        const sa = (a.index_patterns ?? []).join(', ');
        const sb = (b.index_patterns ?? []).join(', ');
        return sa.localeCompare(sb);
      },
      render: (row: LegacyTemplateRow) => (row.index_patterns ?? []).join(', ') || '—'
    },
    {
      key: 'order' as const,
      header: 'Order',
      className: 'tab-content-value',
      sortable: true,
      sortFn: (a: LegacyTemplateRow, b: LegacyTemplateRow) => {
        const oa = Number(a.order) || 0;
        const ob = Number(b.order) || 0;
        return oa - ob;
      },
      render: (row: LegacyTemplateRow) => row.order ?? '—'
    },
    {
      key: 'legacy_badge' as const,
      header: '',
      className: 'tab-content-value',
      sortable: false,
      render: () => (
        <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300">
          Legacy
        </span>
      )
    }
  ];

  const sortedIndexTemplates = useMemo(
    () => sortRows(filteredIndexTemplates, indexTemplateColumns as any, indexSortColumn, indexSortDirection),
    [filteredIndexTemplates, indexTemplateColumns, indexSortColumn, indexSortDirection, sortRows]
  );
  const paginatedIndexTemplates = useMemo(
    () => sortedIndexTemplates.slice(
      (indexTemplatesPage - 1) * indexTemplatesPageSize,
      indexTemplatesPage * indexTemplatesPageSize
    ),
    [sortedIndexTemplates, indexTemplatesPage, indexTemplatesPageSize]
  );

  const sortedLegacyTemplates = useMemo(
    () => sortRows(filteredLegacyTemplates, legacyTemplateColumns as any, legacySortColumn, legacySortDirection),
    [filteredLegacyTemplates, legacyTemplateColumns, legacySortColumn, legacySortDirection, sortRows]
  );
  const paginatedLegacyTemplates = useMemo(
    () => sortedLegacyTemplates.slice(
      (legacyTemplatesPage - 1) * legacyTemplatesPageSize,
      legacyTemplatesPage * legacyTemplatesPageSize
    ),
    [sortedLegacyTemplates, legacyTemplatesPage, legacyTemplatesPageSize]
  );

  const listEmpty = indexTemplates.length === 0 && legacyTemplates.length === 0;

  if (!activeCluster) {
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400">
        No cluster selected.
      </div>
    );
  }

  if (loading && listEmpty) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-300 bg-white p-8 dark:bg-gray-800 dark:border-gray-600">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (forbidden || (error && listEmpty)) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/50 shadow-sm max-h-[85vh] min-h-0 flex flex-col overflow-hidden">
        <div className="p-4 text-sm text-gray-700 dark:text-gray-300 relative flex flex-col min-h-0 overflow-y-auto">
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPermissionHelpOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {permissionHelpOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              Insufficient permissions — Requires <code className="font-mono text-xs">manage_index_templates</code>
            </button>
            {permissionHelpOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Description</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Listing index templates requires <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded font-mono">manage_index_templates</code> cluster privilege.
                    </p>
                    <a
                      href="https://www.elastic.co/docs/reference/elasticsearch/roles"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1.5 inline-block"
                    >
                      Official Documentation
                    </a>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Kibana Dev Tools</p>
                    <CodeBlockWithCopy text={TEMPLATES_KIBANA_SNIPPET} label="Role snippet" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">Terminal (cURL)</p>
                    <CodeBlockWithCopy text={curlSnippet} label="curl" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (indexTemplates.length > 0 || legacyTemplates.length > 0) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={indexExpanded}
              onToggle={() => toggleTemplateSection('index')}
              label="Composable index templates"
              fillHitArea={true}
              suffix={
                <InfoPopup
                  title="Composable templates"
                  modalTitle="Composable index templates"
                  open={infoOpenComposable}
                  onOpen={() => setInfoOpenComposable(true)}
                  onClose={() => setInfoOpenComposable(false)}
                >
                  <p>
                    From <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _index_template</code>. Click a row name to view the template body.
                  </p>
                </InfoPopup>
              }
            />
          </div>
          {indexExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search name, patterns, fields…"
                  value={indexSearchTerm}
                  onChange={(e) => setIndexSearchTerm(e.target.value)}
                  className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
                  aria-label="Search composable templates"
                />
                {indexSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setIndexSearchTerm('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Pagination
                currentPage={indexTemplatesPage}
                totalPages={Math.max(1, Math.ceil(sortedIndexTemplates.length / Math.max(1, indexTemplatesPageSize)))}
                totalItems={sortedIndexTemplates.length}
                pageSize={indexTemplatesPageSize}
                onPageChange={setIndexTemplatesPage}
                inline
              />
              <select
                value={String(indexTemplatesPageSize)}
                onChange={(e) => setIndexTemplatesPageSize(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5"
                aria-label="Items per page (composable)"
              >
                {[10, 20, 100].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {indexExpanded && (
          <div className="tab-section-body">
            <div className="tab-section-scroll tab-section-scroll-flush">
              <DataTable
                data={paginatedIndexTemplates}
                columns={indexTemplateColumns}
                emptyMessage="No index templates. Add a cluster and refresh, or create templates in Kibana/API."
                tableId="templates-index"
                dense
                controlledSort={{
                  sortColumn: indexSortColumn,
                  sortDirection: indexSortDirection,
                  onSortChange: (column, direction) => {
                    setIndexSortColumn(column);
                    setIndexSortDirection(direction);
                    setIndexTemplatesPage(1);
                  }
                }}
              />
            </div>
          </div>
        )}
      </section>

      <section className="tab-section-card">
        <div className="tab-section-header tab-section-header-split">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabSectionExpandTrigger
              expanded={legacyExpanded}
              onToggle={() => toggleTemplateSection('legacy')}
              label="Legacy index templates"
              fillHitArea={true}
              suffix={
                <InfoPopup
                  title="Legacy templates"
                  modalTitle="Legacy index templates"
                  open={infoOpenLegacy}
                  onOpen={() => setInfoOpenLegacy(true)}
                  onClose={() => setInfoOpenLegacy(false)}
                >
                  <p>
                    From <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GET _template</code>. Click a row name to view the template body.
                  </p>
                </InfoPopup>
              }
            />
          </div>
          {legacyExpanded && (
            <div className="tab-section-inline-tools">
              <div className="relative min-w-[8rem] max-w-[14rem] flex-1 sm:flex-none sm:w-44">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search name, patterns, fields…"
                  value={legacySearchTerm}
                  onChange={(e) => setLegacySearchTerm(e.target.value)}
                  className="w-full pl-6 pr-6 py-1 text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tab-content-value"
                  aria-label="Search legacy templates"
                />
                {legacySearchTerm && (
                  <button
                    type="button"
                    onClick={() => setLegacySearchTerm('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Pagination
                currentPage={legacyTemplatesPage}
                totalPages={Math.max(1, Math.ceil(sortedLegacyTemplates.length / Math.max(1, legacyTemplatesPageSize)))}
                totalItems={sortedLegacyTemplates.length}
                pageSize={legacyTemplatesPageSize}
                onPageChange={setLegacyTemplatesPage}
                inline
              />
              <select
                value={String(legacyTemplatesPageSize)}
                onChange={(e) => setLegacyTemplatesPageSize(parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE)}
                className="text-xs border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5"
                aria-label="Items per page (legacy)"
              >
                {[10, 20, 100].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {legacyExpanded && (
          <div className="tab-section-body">
            <div className="tab-section-scroll tab-section-scroll-flush">
              <DataTable
                data={paginatedLegacyTemplates}
                columns={legacyTemplateColumns}
                emptyMessage="No legacy templates. Add a cluster and refresh, or create templates via API."
                tableId="templates-legacy"
                dense
                controlledSort={{
                  sortColumn: legacySortColumn,
                  sortDirection: legacySortDirection,
                  onSortChange: (column, direction) => {
                    setLegacySortColumn(column);
                    setLegacySortDirection(direction);
                    setLegacyTemplatesPage(1);
                  }
                }}
              />
            </div>
          </div>
        )}
      </section>

      {selectedTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            templateModalBackdropMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && templateModalBackdropMouseDownRef.current) {
              setSelectedTemplate(null);
            }
            templateModalBackdropMouseDownRef.current = false;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-modal-title"
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600 shrink-0">
              <h3 id="template-modal-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono truncate">
                {selectedTemplate.name} ({selectedTemplate.type})
              </h3>
              <button
                type="button"
                onClick={() => setSelectedTemplate(null)}
                className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="p-4 overflow-auto text-xs font-mono tab-content-value bg-gray-50 dark:bg-gray-900/50 min-h-0 flex-1">
              {JSON.stringify(selectedTemplate.body, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
