import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IndexDetailsResponse } from '@/types/api';
import { isAllIndicesQueryPattern } from '@/utils/querySearch';
import {
  DEFAULT_CHART_PRESET,
  mergeDateFieldsFromMappingsResponse,
  pickDefaultTimeField,
  resolvePresetTimeRange,
  resolveChartFilterRange,
  withTimeField,
  type TimeRangeFilter,
  type TimeRangePreset
} from '@/utils/queryTimeHistogram';

type UseQueryTimeHistogramStateOptions = {
  indexPattern: string;
  enabled: boolean;
  indexDetails: IndexDetailsResponse | null;
  indexDetailsLoading: boolean;
};

export function useQueryTimeHistogramState({
  indexPattern,
  enabled,
  indexDetails,
  indexDetailsLoading
}: UseQueryTimeHistogramStateOptions) {
  const visible = enabled;

  const [collapsed, setCollapsed] = useState(true);
  const [timePreset, setTimePreset] = useState<TimeRangePreset>(DEFAULT_CHART_PRESET);
  const [dateFields, setDateFields] = useState<string[]>([]);
  const [selectedTimeField, setSelectedTimeField] = useState('');
  const [brushRange, setBrushRange] = useState<TimeRangeFilter | null>(null);

  const indexPatternRef = useRef(indexPattern);

  useEffect(() => {
    if (!visible) {
      setDateFields([]);
      setSelectedTimeField('');
      setBrushRange(null);
      setTimePreset(DEFAULT_CHART_PRESET);
      setCollapsed(true);
      return;
    }

    if (indexPatternRef.current !== indexPattern) {
      indexPatternRef.current = indexPattern;
      setDateFields([]);
      setSelectedTimeField('');
      setBrushRange(null);
      setTimePreset(DEFAULT_CHART_PRESET);
      setCollapsed(true);
    }
  }, [indexPattern, visible]);

  useEffect(() => {
    if (!visible) return;

    if (isAllIndicesQueryPattern(indexPattern)) {
      if (indexDetailsLoading) return;

      const fields = indexDetails ? mergeDateFieldsFromMappingsResponse(indexDetails) : [];
      if (fields.length > 0) {
        setDateFields(fields);
        setSelectedTimeField(pickDefaultTimeField(fields) ?? fields[0]);
      } else {
        setDateFields([]);
        setSelectedTimeField('');
      }
      return;
    }

    if (indexDetailsLoading || !indexDetails) {
      return;
    }

    const fields = mergeDateFieldsFromMappingsResponse(indexDetails);
    if (fields.length === 0) {
      setDateFields([]);
      setSelectedTimeField('');
      return;
    }
    setDateFields(fields);
    setSelectedTimeField(pickDefaultTimeField(fields) ?? fields[0]);
  }, [visible, indexDetails, indexDetailsLoading, indexPattern]);

  const hasMappingDateField = dateFields.length > 0 && Boolean(selectedTimeField);
  const chartVisible = visible && hasMappingDateField;

  const windowRange = useMemo(() => {
    const base = resolvePresetTimeRange(timePreset);
    return selectedTimeField ? withTimeField(base, selectedTimeField) : base;
  }, [timePreset, selectedTimeField]);

  const activeFilterRange = useMemo(
    () => resolveChartFilterRange(timePreset, selectedTimeField, brushRange),
    [brushRange, timePreset, selectedTimeField]
  );

  /** Time filter applies only when the chart is expanded. */
  const timeRangeForSearch =
    chartVisible && !collapsed && selectedTimeField ? activeFilterRange : null;

  const isReadyForSearch = chartVisible && !indexDetailsLoading && Boolean(selectedTimeField);

  const handlePresetChange = useCallback((preset: TimeRangePreset) => {
    setTimePreset(preset);
    setBrushRange(null);
  }, []);

  const handleTimeFieldChange = useCallback((field: string) => {
    setSelectedTimeField(field);
    setBrushRange(null);
  }, []);

  const handleBrushSelect = useCallback((range: TimeRangeFilter) => {
    setBrushRange(range);
  }, []);

  const clearBrushRange = useCallback(() => setBrushRange(null), []);

  return {
    visible: chartVisible,
    collapsed,
    setCollapsed,
    timePreset,
    setTimePreset: handlePresetChange,
    dateFields,
    selectedTimeField,
    setSelectedTimeField: handleTimeFieldChange,
    windowRange,
    activeFilterRange,
    brushRange,
    timeRangeForSearch,
    isReadyForSearch,
    fieldsLoading: visible && indexDetailsLoading && !isAllIndicesQueryPattern(indexPattern),
    handleBrushSelect,
    clearBrushRange
  };
}

export type QueryTimeHistogramState = ReturnType<typeof useQueryTimeHistogramState>;
