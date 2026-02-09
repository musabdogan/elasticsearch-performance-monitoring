import type { ChartDataPoint, NodeStats, PerformanceHistory, PerformanceMetrics } from '@/types/api';

/**
 * Performance tracker for calculating rates and managing historical data
 */
export class PerformanceTracker {
  private history: PerformanceHistory[] = [];
  private chartData: ChartDataPoint[] = [];
  private readonly maxHistorySize = 120; // 10 minutes (5s * 120)
  private readonly maxChartSize = 60; // 5 minutes for UI charts
  private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Load from sessionStorage if available
    this.loadFromStorage();

    // Periodic cleanup
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Add new snapshot data and calculate current metrics
   */
  addSnapshot(nodeStats: NodeStats, selectedNodeId?: string | null, indexStats?: any, selectedIndex?: string | null): PerformanceMetrics {
    const timestamp = Date.now();

    // Calculate totals - cluster wide, node specific, or index specific
    let totalIndexingOps = 0;
    let totalIndexTimeMs = 0;
    let totalSearchOps = 0;
    let totalSearchTimeMs = 0;

    if (selectedIndex && indexStats?.indices?.[selectedIndex]) {
      // Index specific metrics
      // Per Elastic's definition:
      // - Indexing rate/latency: Use primaries only (documents indexed per second on primary shards)
      // - Search rate/latency: Use total (search requests per second on all shards)
      const indexData = indexStats.indices[selectedIndex];
      
      // Indexing metrics from primaries (fallback to total if primaries not available)
      const indexingStats = indexData.primaries?.indexing || indexData.total?.indexing;
      totalIndexingOps = indexingStats?.index_total || 0;
      totalIndexTimeMs = indexingStats?.index_time_in_millis || 0;
      
      // Search metrics from total (fallback to primaries if total not available)
      const searchStats = indexData.total?.search || indexData.primaries?.search;
      totalSearchOps = searchStats?.query_total || 0;
      totalSearchTimeMs = searchStats?.query_time_in_millis || 0;
    } else if (selectedNodeId && nodeStats.nodes[selectedNodeId]) {
      // Node specific metrics
      const node = nodeStats.nodes[selectedNodeId];
      totalIndexingOps = node.indices.indexing.index_total;
      totalIndexTimeMs = node.indices.indexing.index_time_in_millis;
      totalSearchOps = node.indices.search.query_total;
      totalSearchTimeMs = node.indices.search.query_time_in_millis;
    } else {
      // Cluster wide metrics (all nodes)
      Object.values(nodeStats.nodes).forEach((node) => {
        totalIndexingOps += node.indices.indexing.index_total;
        totalIndexTimeMs += node.indices.indexing.index_time_in_millis;
        totalSearchOps += node.indices.search.query_total;
        totalSearchTimeMs += node.indices.search.query_time_in_millis;
      });
    }

    const currentEntry: PerformanceHistory = {
      timestamp,
      totalIndexingOps,
      totalSearchOps,
      totalIndexTimeMs,
      totalSearchTimeMs
    };

    this.history.push(currentEntry);

    // Maintain history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // Calculate current metrics
    const metrics = this.calculateCurrentMetrics();

    // Add to chart data
    this.addChartDataPoint(timestamp, metrics);

    // Save to sessionStorage
    this.saveToStorage();

    return metrics;
  }

  /** Minimum time between snapshots (seconds) to trust rate calculations; avoids huge spikes on cluster switch or double-fetch */
  private readonly MIN_TIME_DIFF_SECONDS = 1;
  /** Sanity cap: rates above this are considered invalid (e.g. from mixed cluster data) */
  private readonly MAX_RATE_PER_SEC = 50_000_000;
  /** Sanity cap: latencies above this (ms) are capped to avoid display glitches */
  private readonly MAX_LATENCY_MS = 300_000;

  /**
   * Calculate current performance metrics based on history
   */
  private calculateCurrentMetrics(): PerformanceMetrics {
    // Need at least 2 data points to calculate rates
    if (this.history.length < 2) {
      return {
        indexingRate: 0,
        searchRate: 0,
        indexLatency: 0,
        searchLatency: 0
      };
    }

    const current = this.history[this.history.length - 1];
    const previous = this.history[this.history.length - 2];

    const timeDiffSeconds = (current.timestamp - previous.timestamp) / 1000;

    if (timeDiffSeconds <= 0 || timeDiffSeconds < this.MIN_TIME_DIFF_SECONDS) {
      return {
        indexingRate: 0,
        searchRate: 0,
        indexLatency: 0,
        searchLatency: 0
      };
    }

    const indexingOpsDiff = Math.max(0, current.totalIndexingOps - previous.totalIndexingOps);
    const searchOpsDiff = Math.max(0, current.totalSearchOps - previous.totalSearchOps);
    const indexTimeDiffMs = Math.max(0, current.totalIndexTimeMs - previous.totalIndexTimeMs);
    const searchTimeDiffMs = Math.max(0, current.totalSearchTimeMs - previous.totalSearchTimeMs);

    // Rate: delta ops / time. Latency: delta time / delta ops (recent interval), not cumulative average
    let indexLatency =
      indexingOpsDiff > 0 ? indexTimeDiffMs / indexingOpsDiff : 0;
    let searchLatency =
      searchOpsDiff > 0 ? searchTimeDiffMs / searchOpsDiff : 0;

    let indexingRate = Math.max(0, indexingOpsDiff / timeDiffSeconds);
    let searchRate = Math.max(0, searchOpsDiff / timeDiffSeconds);

    // Sanity caps: ignore impossible rates (e.g. from cluster switch mixing data)
    if (indexingRate > this.MAX_RATE_PER_SEC) indexingRate = 0;
    if (searchRate > this.MAX_RATE_PER_SEC) searchRate = 0;
    if (indexLatency > this.MAX_LATENCY_MS) indexLatency = this.MAX_LATENCY_MS;
    if (searchLatency > this.MAX_LATENCY_MS) searchLatency = this.MAX_LATENCY_MS;

    return {
      indexingRate,
      searchRate,
      indexLatency,
      searchLatency
    };
  }

  /**
   * Add data point to chart data
   */
  private addChartDataPoint(timestamp: number, metrics: PerformanceMetrics): void {
    const chartPoint: ChartDataPoint = {
      timestamp,
      ...metrics
    };

    this.chartData.push(chartPoint);

    // Maintain chart data size
    if (this.chartData.length > this.maxChartSize) {
      this.chartData = this.chartData.slice(-this.maxChartSize);
    }
  }

  /**
   * Get chart data for UI components
   */
  getChartData(): ChartDataPoint[] {
    return [...this.chartData];
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): PerformanceMetrics {
    return this.calculateCurrentMetrics();
  }

  /**
   * Clean up old data
   */
  private cleanup(): void {
    const cutoffTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago

    this.history = this.history.filter((entry: PerformanceHistory) => entry.timestamp > cutoffTime);
    this.chartData = this.chartData.filter((point: ChartDataPoint) => point.timestamp > cutoffTime);

    this.saveToStorage();
  }

  /**
   * Save data to sessionStorage
   */
  private saveToStorage(): void {
    try {
      const data = {
        history: this.history.slice(-50), // Save last 50 entries
        chartData: this.chartData
      };
      sessionStorage.setItem('elasticsearch-performance-data', JSON.stringify(data));
    } catch (error) {
      // Ignore storage errors (quota exceeded, etc.)
      console.warn('Failed to save performance data to storage:', error);
    }
  }

  /**
   * Load data from sessionStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = sessionStorage.getItem('elasticsearch-performance-data');
      if (stored) {
        const data = JSON.parse(stored);

        // Validate and load history
        if (Array.isArray(data.history)) {
        this.history = data.history.filter((entry: any) =>
          entry.timestamp &&
          typeof entry.totalIndexingOps === 'number' &&
          typeof entry.totalSearchOps === 'number'
        );
        }

        // Validate and load chart data
        if (Array.isArray(data.chartData)) {
        this.chartData = data.chartData.filter((point: any) =>
          point.timestamp &&
          typeof point.indexingRate === 'number' &&
          typeof point.searchRate === 'number'
        );
        }

        // Clean up old data
        this.cleanup();
      }
    } catch (error) {
      // Ignore parsing errors
      console.warn('Failed to load performance data from storage:', error);
    }
  }

  /**
   * Clear all data (useful for cluster switches)
   */
  clearData(): void {
    this.history = [];
    this.chartData = [];
    sessionStorage.removeItem('elasticsearch-performance-data');
  }

  /**
   * Get performance summary for the last N minutes
   */
  getPerformanceSummary(minutes: number = 5): {
    avgIndexingRate: number;
    avgSearchRate: number;
    peakIndexingRate: number;
    peakSearchRate: number;
  } {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    const recentData = this.chartData.filter((point: ChartDataPoint) => point.timestamp > cutoffTime);

    if (recentData.length === 0) {
      return {
        avgIndexingRate: 0,
        avgSearchRate: 0,
        peakIndexingRate: 0,
        peakSearchRate: 0
      };
    }

    const indexingRates = recentData.map(d => d.indexingRate);
    const searchRates = recentData.map(d => d.searchRate);

    return {
      avgIndexingRate: indexingRates.reduce((sum, rate) => sum + rate, 0) / indexingRates.length,
      avgSearchRate: searchRates.reduce((sum, rate) => sum + rate, 0) / searchRates.length,
      peakIndexingRate: Math.max(...indexingRates),
      peakSearchRate: Math.max(...searchRates)
    };
  }
}
