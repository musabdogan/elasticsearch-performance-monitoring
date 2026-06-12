import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '@/types/api';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import {
  columnsEqual,
  getDefaultColumnsFromFieldUsage,
  insertColumn,
  mergeAvailableSourceFields,
  META_FIELD_ID,
  META_FIELD_INDEX,
  readStoredColumns,
  reorderColumns,
  resolveDefaultDataColumns,
  writeStoredColumns
} from '@/utils/indexDataTable';

function prependIndexIfNeeded(columns: string[]): string[] {
  if (columns.includes(META_FIELD_INDEX)) return columns;
  const idIndex = columns.indexOf(META_FIELD_ID);
  if (idIndex === -1) return [META_FIELD_INDEX, ...columns];
  const next = [...columns];
  next.splice(idIndex + 1, 0, META_FIELD_INDEX);
  return next;
}

export type FieldDragPayload = {
  field: string;
  source: 'sidebar' | 'column';
  fromIndex?: number;
};

export const FIELD_DRAG_MIME = 'application/x-es-monitor-field';

export function parseFieldDragPayload(dataTransfer: DataTransfer): FieldDragPayload | null {
  const raw = dataTransfer.getData(FIELD_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FieldDragPayload;
    if (typeof parsed.field !== 'string' || !parsed.field) return null;
    if (parsed.source !== 'sidebar' && parsed.source !== 'column') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setFieldDragPayload(dataTransfer: DataTransfer, payload: FieldDragPayload): void {
  dataTransfer.setData(FIELD_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'move';
}

export function useDocumentColumns(
  scopeKey: string,
  hits: SearchHit[],
  fieldUsageSummary?: FieldUsageSummary | null,
  includeIndexField = false
) {
  const availableFields = useMemo(
    () => mergeAvailableSourceFields(hits, fieldUsageSummary, includeIndexField),
    [hits, fieldUsageSummary, includeIndexField]
  );
  const defaultColumns = useMemo(() => {
    const cols = resolveDefaultDataColumns(hits, fieldUsageSummary);
    return includeIndexField ? prependIndexIfNeeded(cols) : cols;
  }, [hits, fieldUsageSummary, includeIndexField]);
  const pageDefaults = useMemo(() => {
    const cols = resolveDefaultDataColumns(hits);
    return includeIndexField ? prependIndexIfNeeded(cols) : cols;
  }, [hits, includeIndexField]);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const needsInitRef = useRef(true);
  const userModifiedRef = useRef(false);

  useEffect(() => {
    needsInitRef.current = true;
    userModifiedRef.current = false;
    setSelectedColumns([]);
  }, [scopeKey]);

  useEffect(() => {
    if (hits.length === 0 || !needsInitRef.current) return;

    const saved = readStoredColumns(scopeKey);
    if (saved?.length) {
      needsInitRef.current = false;
      setSelectedColumns(saved);
      return;
    }

    needsInitRef.current = false;
    setSelectedColumns(defaultColumns);
  }, [hits.length, scopeKey, defaultColumns]);

  useEffect(() => {
    if (!fieldUsageSummary?.hasUsageData || userModifiedRef.current) return;
    if (readStoredColumns(scopeKey)?.length) return;

    setSelectedColumns((prev) => {
      if (prev.length === 0) return defaultColumns;
      if (columnsEqual(prev, pageDefaults) && !columnsEqual(defaultColumns, pageDefaults)) {
        return defaultColumns;
      }
      return prev;
    });
  }, [fieldUsageSummary, defaultColumns, pageDefaults, scopeKey]);

  useEffect(() => {
    if (selectedColumns.length === 0) return;
    writeStoredColumns(scopeKey, selectedColumns);
  }, [selectedColumns, scopeKey]);

  const markUserModified = useCallback(() => {
    userModifiedRef.current = true;
  }, []);

  const addColumn = useCallback(
    (field: string, atIndex?: number) => {
      markUserModified();
      setSelectedColumns((prev) => {
        if (prev.includes(field)) return prev;
        const index = atIndex ?? prev.length;
        return insertColumn(prev, field, index);
      });
    },
    [markUserModified]
  );

  const removeColumn = useCallback(
    (field: string) => {
      markUserModified();
      setSelectedColumns((prev) => prev.filter((col) => col !== field));
    },
    [markUserModified]
  );

  const toggleColumn = useCallback(
    (field: string) => {
      markUserModified();
      setSelectedColumns((prev) =>
        prev.includes(field) ? prev.filter((col) => col !== field) : [...prev, field]
      );
    },
    [markUserModified]
  );

  const handleColumnDrop = useCallback(
    (targetIndex: number, payload: FieldDragPayload) => {
      markUserModified();
      setDropTargetIndex(null);
      if (payload.source === 'column' && payload.fromIndex != null) {
        setSelectedColumns((prev) => {
          const from = payload.fromIndex!;
          let to = targetIndex;
          if (from < to) to -= 1;
          return reorderColumns(prev, from, to);
        });
        return;
      }
      setSelectedColumns((prev) => insertColumn(prev, payload.field, targetIndex));
    },
    [markUserModified]
  );

  const handleDropAtEnd = useCallback(
    (payload: FieldDragPayload) => {
      markUserModified();
      setDropTargetIndex(null);
      if (payload.source === 'column' && payload.fromIndex != null) {
        setSelectedColumns((prev) => {
          const from = payload.fromIndex!;
          return reorderColumns(prev, from, prev.length - 1);
        });
        return;
      }
      setSelectedColumns((prev) => {
        if (prev.includes(payload.field)) return prev;
        return [...prev, payload.field];
      });
    },
    [markUserModified]
  );

  const resetToDefault = useCallback(() => {
    userModifiedRef.current = false;
    setSelectedColumns(defaultColumns);
  }, [defaultColumns]);

  const defaultsFromFieldUsage = useMemo(
    () => Boolean(getDefaultColumnsFromFieldUsage(fieldUsageSummary)?.length),
    [fieldUsageSummary]
  );

  return {
    availableFields,
    selectedColumns,
    dropTargetIndex,
    defaultsFromFieldUsage,
    setDropTargetIndex,
    addColumn,
    removeColumn,
    toggleColumn,
    handleColumnDrop,
    handleDropAtEnd,
    resetToDefault
  };
}
