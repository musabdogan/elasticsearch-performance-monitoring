import { useDocumentSearch } from '@/hooks/useDocumentSearch';
import type { ClusterConnection } from '@/types/app';

/** Index-scoped document search (Simple mode). Used by Index Detail Data tab. */
export function useIndexDocumentSearch(
  cluster: ClusterConnection | null,
  indexName: string,
  enabled: boolean
) {
  return useDocumentSearch(cluster, indexName, enabled, {
    mode: 'simple',
    autoRun: true
  });
}
