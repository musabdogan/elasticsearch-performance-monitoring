import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleMinus, CirclePlus, GripVertical, RotateCcw, Search } from 'lucide-react';
import type { DiscoverFieldGroup } from '@/types/discover';
import type { SearchHit } from '@/types/api';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { setFieldDragPayload } from '@/hooks/useDocumentColumns';
import { buildDiscoverFieldGroups } from '@/utils/discoverFieldGroups';
import { DISCOVER_SIDEBAR_WIDTH_CLASS } from '@/components/query/discoverLayout';
import { fieldTypeIconLabel, resolveMappingFieldType } from '@/utils/fieldMappingTypes';
import { FieldTopValuesPopover } from '@/components/query/FieldTopValuesPopover';
import { getConnectedElementRect } from '@/utils/anchoredPopoverPosition';
import type { DiscoverFilter } from '@/types/discover';
import type { FieldTopValuesResult } from '@/types/discover';

type DiscoverFieldsPanelProps = {
  availableFields: string[];
  selectedColumns: string[];
  hits: SearchHit[];
  fieldUsageSummary?: FieldUsageSummary | null;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
  defaultsFromFieldUsage?: boolean;
  autoColumns?: boolean;
  onAutoColumnsChange?: (enabled: boolean) => void;
  onToggleField: (field: string) => void;
  onReset: () => void;
  activeFilters: DiscoverFilter[];
  topValuesField: string | null;
  topValuesAggField: string | null;
  topValuesResult: FieldTopValuesResult | null;
  topValuesLoading: boolean;
  topValuesError: string | null;
  onOpenField: (field: string, anchor: DOMRect) => void;
  onCloseTopValues: () => void;
  onAddFilter: (field: string, aggField: string, value: string | number | boolean, negate: boolean) => void;
};

const DEFAULT_EXPANDED: Record<string, boolean> = {
  selected: true,
  popular: true,
  available: false,
  meta: false
};

function FieldTypeIcon({
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

export function DiscoverFieldsPanel({
  availableFields,
  selectedColumns,
  hits,
  fieldUsageSummary,
  mappings,
  defaultsFromFieldUsage = false,
  autoColumns = true,
  onAutoColumnsChange,
  onToggleField,
  onReset,
  activeFilters,
  topValuesField,
  topValuesAggField,
  topValuesResult,
  topValuesLoading,
  topValuesError,
  onOpenField,
  onCloseTopValues,
  onAddFilter
}: DiscoverFieldsPanelProps) {
  const [nameFilter, setNameFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(DEFAULT_EXPANDED);
  const sidebarRef = useRef<HTMLElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const groups = useMemo(
    () =>
      buildDiscoverFieldGroups({
        selectedColumns,
        availableFields,
        hits,
        fieldUsageSummary,
        mappings,
        nameFilter
      }),
    [
      selectedColumns,
      availableFields,
      hits,
      fieldUsageSummary,
      mappings,
      nameFilter
    ]
  );

  const selectedSet = useMemo(() => new Set(selectedColumns), [selectedColumns]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleFieldClick = (field: string) => {
    if (topValuesField === field) {
      onCloseTopValues();
      return;
    }
    const el = rowRefs.current[field];
    const rect = el?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
    onOpenField(field, rect);
  };

  const getTopValuesAnchorRect = useCallback(() => {
    if (!topValuesField) return null;
    return getConnectedElementRect(rowRefs.current[topValuesField]);
  }, [topValuesField]);

  const getSidebarRect = useCallback(() => getConnectedElementRect(sidebarRef.current), []);

  const getSidebarElement = useCallback(() => sidebarRef.current, []);

  const handleAddFilterFromPopover = (
    field: string,
    _aggFieldFromPopover: string,
    value: string | number | boolean,
    negate: boolean
  ) => {
    const aggField = topValuesAggField ?? _aggFieldFromPopover;
    onAddFilter(field, aggField, value, negate);
  };

  return (
    <aside
      ref={sidebarRef}
      className={`relative flex min-h-0 ${DISCOVER_SIDEBAR_WIDTH_CLASS} flex-col self-stretch border-r border-gray-200 bg-gray-50/90 dark:border-gray-700 dark:bg-gray-900/50`}
    >
      <div className="border-b border-gray-200 px-2 py-2 dark:border-gray-700">
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Fields</span>
          <button
            type="button"
            onClick={onReset}
            title={
              defaultsFromFieldUsage
                ? 'Reset columns to most-used fields'
                : 'Reset columns to default'
            }
            className="rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Search field names"
            className="w-full rounded border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            aria-label="Search field names"
          />
        </div>
        {onAutoColumnsChange && (
          <div className="mt-2 flex items-start justify-between gap-2 rounded border border-gray-200/80 bg-white/70 px-2 py-1.5 dark:border-gray-600/80 dark:bg-gray-800/40">
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Auto columns</span>
              <p className="text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                {autoColumns ? 'Updates columns when index changes' : 'Keeps your column pick'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoColumns}
              aria-label="Auto columns"
              onClick={() => onAutoColumnsChange(!autoColumns)}
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                autoColumns ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  autoColumns ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((group: DiscoverFieldGroup) => {
          const isOpen = expanded[group.id] ?? DEFAULT_EXPANDED[group.id] ?? false;
          return (
            <div key={group.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {group.fields.length}
                </span>
              </button>
              {isOpen && (
                <ul>
                  {group.fields.map((field) => {
                    const active = selectedSet.has(field);
                    return (
                      <li key={`${group.id}-${field}`} className="group flex items-center gap-0.5 pr-1">
                        <button
                          type="button"
                          draggable
                          ref={(el) => {
                            rowRefs.current[field] = el;
                          }}
                          onDragStart={(e) => {
                            setFieldDragPayload(e.dataTransfer, { field, source: 'sidebar' });
                            e.dataTransfer.setData('text/plain', field);
                          }}
                          onClick={() => handleFieldClick(field)}
                          className={`flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left text-sm font-mono transition-colors ${
                            topValuesField === field
                              ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                              : active
                                ? 'bg-gray-200/60 text-gray-900 dark:bg-gray-700/60 dark:text-gray-100'
                                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/80'
                          }`}
                          title="Show top values"
                        >
                          <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-gray-400 group-active:cursor-grabbing" />
                          <FieldTypeIcon field={field} mappings={mappings} />
                          <span className="min-w-0 flex-1 truncate">{field}</span>
                          {active && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-gray-500">
                              on
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleField(field);
                          }}
                          className={`shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${
                            active
                              ? 'text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200'
                              : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40'
                          }`}
                          title={active ? 'Remove field from table' : 'Add field to table'}
                          aria-label={active ? `Remove ${field} from table` : `Add ${field} to table`}
                        >
                          {active ? (
                            <CircleMinus className="h-4 w-4" />
                          ) : (
                            <CirclePlus className="h-4 w-4" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {topValuesField && (
        <FieldTopValuesPopover
          field={topValuesField}
          aggField={topValuesAggField ?? topValuesField}
          getAnchorRect={getTopValuesAnchorRect}
          getSidebarRect={getSidebarRect}
          getSidebarElement={getSidebarElement}
          result={topValuesResult}
          loading={topValuesLoading}
          error={topValuesError}
          activeFilters={activeFilters}
          onClose={onCloseTopValues}
          onAddFilter={handleAddFilterFromPopover}
        />
      )}
    </aside>
  );
}
