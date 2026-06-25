import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterConnection } from '@/types/app';
import type { FieldTopValuesResult } from '@/types/discover';
import { searchIndexDocuments } from '@/services/elasticsearch';
import {
  buildFieldTopValuesSearchBody,
  parseFieldTopValuesResponse
} from '@/utils/fieldTopValues';
import { getClusterConnectionKey } from '@/utils/clusterConnectionKey';
import type { TimeRangeFilter } from '@/utils/queryTimeHistogram';

type UseFieldTopValuesOptions = {
  cluster: ClusterConnection | null;
  indexPattern: string;
  enabled: boolean;
  buildBaseSearchBody: () => Record<string, unknown> | null;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
  getTimeRange?: () => TimeRangeFilter | null;
  /** When true (time chart collapsed), add exists filter on the agg field. */
  getRequireFieldExists?: () => boolean;
};

export function useFieldTopValues({
  cluster,
  indexPattern,
  enabled,
  buildBaseSearchBody,
  mappings,
  getTimeRange,
  getRequireFieldExists
}: UseFieldTopValuesOptions) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [aggField, setAggField] = useState<string | null>(null);
  const [result, setResult] = useState<FieldTopValuesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const clusterConnectionKey = getClusterConnectionKey(cluster);

  const close = useCallback(() => {
    setActiveField(null);
    setAggField(null);
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  const openField = useCallback((field: string, resolvedAggField: string) => {
    setActiveField(field);
    setAggField(resolvedAggField);
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled || !cluster || !activeField || !aggField || !indexPattern.trim()) {
      return;
    }

    const base = buildBaseSearchBody();
    if (!base) {
      setError('Could not build search context');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const timeRange = getTimeRange?.() ?? null;
    const requireFieldExists = getRequireFieldExists?.() ?? false;
    const body = buildFieldTopValuesSearchBody(base, activeField, aggField, mappings, timeRange, {
      requireFieldExists
    });

    void searchIndexDocuments(cluster, indexPattern, body)
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        setResult(parseFieldTopValuesResponse(response as Record<string, unknown>, activeField, mappings));
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load field values');
        setResult(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [
    enabled,
    clusterConnectionKey,
    indexPattern,
    activeField,
    aggField,
    buildBaseSearchBody,
    mappings,
    getTimeRange,
    getRequireFieldExists
  ]);

  useEffect(() => {
    close();
  }, [clusterConnectionKey, indexPattern, close]);

  return {
    activeField,
    aggField,
    result,
    loading,
    error,
    openField,
    close
  };
}
