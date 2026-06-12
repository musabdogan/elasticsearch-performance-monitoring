import type { QueryMode, SortRule } from '@/utils/querySearch';

const STORAGE_PREFIX = 'es-monitor-query:';

export type QueryPersistedState = {
  indexPattern: string;
  mode: QueryMode;
  simpleQuery: string;
  advancedBody: string;
  size: number;
  from: number;
  sort: SortRule[];
};

function storageKey(clusterLabel: string): string {
  return `${STORAGE_PREFIX}${clusterLabel}`;
}

export function readQueryState(clusterLabel: string): Partial<QueryPersistedState> | null {
  try {
    const raw = sessionStorage.getItem(storageKey(clusterLabel));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<QueryPersistedState>;
  } catch {
    return null;
  }
}

export function writeQueryState(clusterLabel: string, state: QueryPersistedState): void {
  try {
    sessionStorage.setItem(storageKey(clusterLabel), JSON.stringify(state));
  } catch {
    // ignore
  }
}
