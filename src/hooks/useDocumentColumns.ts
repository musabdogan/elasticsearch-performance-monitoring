import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '@/types/api';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import {
  buildDefaultColumnOrder,
  columnsEqual,
  getDefaultColumnsFromFieldUsage,
  insertColumn,
  isDisplayableSourceField,
  isMetaDataField,
  mergeAvailableSourceFields,
  META_FIELD_ID,
  META_FIELD_INDEX,
  readStoredColumns,
  reorderColumns,
  resolveDefaultDataColumns,
  writeStoredColumns
} from '@/utils/indexDataTable';

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

function isStaleBootstrapColumns(
  prev: string[],
  next: string[],
  primaryTimestampField?: string | null
): boolean {
  if (next.length <= prev.length) return false;
  if (prev.length === 0) return true;
  const prevSet = new Set(prev);
  if (![...prevSet].every((field) => next.includes(field))) return false;
  if (prev.length === 1 && primaryTimestampField && prev[0] === primaryTimestampField) return true;
  return prev.length < next.length;
}

export function useDocumentColumns(
  scopeKey: string,
  hits: SearchHit[],
  fieldUsageSummary?: FieldUsageSummary | null,
  includeIndexField = false,
  fieldMetadataReady = true,
  primaryTimestampField?: string | null,
  autoColumns = true,
  /** When false, _id/_index never appear in auto defaults (user can still add from sidebar). */
  allowAutoMetaColumns = false
) {
  const availableFields = useMemo(
    () => mergeAvailableSourceFields(hits, fieldUsageSummary, includeIndexField),
    [hits, fieldUsageSummary, includeIndexField]
  );

  const sanitizeColumns = useCallback(
    (cols: string[]) => cols.filter((col) => isDisplayableSourceField(col) || col === META_FIELD_ID || col === META_FIELD_INDEX),
    []
  );

  const applyAutoColumnPolicy = useCallback(
    (cols: string[]) => {
      const sanitized = sanitizeColumns(cols);
      if (!allowAutoMetaColumns) {
        return sanitized.filter((col) => !isMetaDataField(col));
      }
      if (includeIndexField) {
        const sourceCols = sanitized.filter((col) => !isMetaDataField(col));
        return buildDefaultColumnOrder(sourceCols, primaryTimestampField, true);
      }
      return sanitized.filter((col) => !isMetaDataField(col));
    },
    [allowAutoMetaColumns, includeIndexField, primaryTimestampField, sanitizeColumns]
  );

  const defaultsFromFieldUsage = useMemo(
    () => Boolean(getDefaultColumnsFromFieldUsage(fieldUsageSummary)?.length),
    [fieldUsageSummary]
  );

  const defaultColumns = useMemo(
    () =>
      applyAutoColumnPolicy(
        resolveDefaultDataColumns(hits, fieldUsageSummary, undefined, primaryTimestampField)
      ),
    [hits, fieldUsageSummary, primaryTimestampField, applyAutoColumnPolicy]
  );
  const pageDefaults = useMemo(
    () =>
      applyAutoColumnPolicy(
        resolveDefaultDataColumns(hits, undefined, undefined, primaryTimestampField)
      ),
    [hits, primaryTimestampField, applyAutoColumnPolicy]
  );

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const needsInitRef = useRef(true);
  const userModifiedRef = useRef(false);

  useEffect(() => {
    needsInitRef.current = true;
    if (autoColumns) {
      userModifiedRef.current = false;
    }
    setSelectedColumns([]);
  }, [scopeKey, autoColumns]);

  useEffect(() => {
    if (!fieldMetadataReady || !needsInitRef.current) return;
    const canInitFromUsage = defaultsFromFieldUsage && autoColumns;
    if (!canInitFromUsage && hits.length === 0) return;

    needsInitRef.current = false;
    const saved = readStoredColumns(scopeKey);
    if (saved?.length && (!autoColumns || (!userModifiedRef.current && !defaultsFromFieldUsage))) {
      setSelectedColumns(applyAutoColumnPolicy(saved));
      return;
    }

    setSelectedColumns(defaultColumns);
  }, [
    hits.length,
    scopeKey,
    defaultColumns,
    defaultsFromFieldUsage,
    autoColumns,
    applyAutoColumnPolicy,
    fieldMetadataReady
  ]);

  useEffect(() => {
    if (!autoColumns || !fieldMetadataReady || userModifiedRef.current) return;

    setSelectedColumns((prev) => {
      const next = defaultColumns;
      if (prev.length === 0) return next;
      if (columnsEqual(prev, next)) return prev;

      if (isStaleBootstrapColumns(prev, next, primaryTimestampField)) {
        return next;
      }

      if (defaultsFromFieldUsage) {
        const prevSansMeta = allowAutoMetaColumns ? prev : prev.filter((col) => !isMetaDataField(col));
        if (columnsEqual(prevSansMeta, pageDefaults) || columnsEqual(prevSansMeta, sanitizeColumns(pageDefaults))) {
          return next;
        }
        return prev;
      }

      const prevSansMeta = allowAutoMetaColumns ? prev : prev.filter((col) => !isMetaDataField(col));
      if (columnsEqual(prevSansMeta, sanitizeColumns(pageDefaults))) {
        return next;
      }

      return prev;
    });
  }, [
    defaultColumns,
    pageDefaults,
    defaultsFromFieldUsage,
    autoColumns,
    fieldMetadataReady,
    primaryTimestampField,
    allowAutoMetaColumns,
    sanitizeColumns
  ]);

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
      if (!isDisplayableSourceField(field) && field !== META_FIELD_ID && field !== META_FIELD_INDEX) return;
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
    needsInitRef.current = false;
    setSelectedColumns(defaultColumns);
  }, [defaultColumns]);

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
