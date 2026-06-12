import { useMemo } from 'react';
import { DocumentSearchWorkspace } from '@/components/query/DocumentSearchWorkspace';
import { QuerySimpleSearchBar } from '@/components/query/QuerySimpleSearchBar';
import type { ClusterConnection } from '@/types/app';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { useIndexDocumentSearch } from '@/hooks/useIndexDocumentSearch';
import { useDocumentColumns } from '@/hooks/useDocumentColumns';
import { shouldShowIndexColumn } from '@/utils/indexDataTable';

type IndexDataTabProps = {
  cluster: ClusterConnection;
  indexName: string;
  active: boolean;
  fieldUsageSummary?: FieldUsageSummary | null;
};

export function IndexDataTab({ cluster, indexName, active, fieldUsageSummary }: IndexDataTabProps) {
  const search = useIndexDocumentSearch(cluster, indexName, active);

  const showIndexColumn = useMemo(() => shouldShowIndexColumn(search.hits, indexName), [search.hits, indexName]);

  const columns = useDocumentColumns(indexName, search.hits, fieldUsageSummary, showIndexColumn);

  return (
    <DocumentSearchWorkspace
      cluster={cluster}
      indexLabel={indexName}
      displayIndexName={indexName}
      hits={search.hits}
      from={search.from}
      queryKey={search.query}
      total={search.total}
      took={search.took}
      page={search.page}
      totalPages={search.totalPages}
      loading={search.loading}
      error={search.error}
      forbidden={search.forbidden}
      availableFields={columns.availableFields}
      selectedColumns={columns.selectedColumns}
      dropTargetIndex={columns.dropTargetIndex}
      defaultsFromFieldUsage={columns.defaultsFromFieldUsage}
      setDropTargetIndex={columns.setDropTargetIndex}
      toggleColumn={columns.toggleColumn}
      removeColumn={columns.removeColumn}
      handleColumnDrop={columns.handleColumnDrop}
      handleDropAtEnd={columns.handleDropAtEnd}
      resetToDefault={columns.resetToDefault}
      pagination={{
        size: search.size,
        onSizeChange: search.changeSize,
        canPrev: search.canPrev,
        canNext: search.canNext,
        onPrev: search.goPrev,
        onNext: search.goNext
      }}
      searchSection={
        <QuerySimpleSearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          onSearch={() => search.search()}
          loading={search.loading}
        />
      }
    />
  );
}
