export type IndexDetailTab = 'overview' | 'data' | 'mappings' | 'settings' | 'ilm';

export type GlobalIndexModalState = {
  indexName: string;
  tab?: IndexDetailTab;
};

export type OpenIndexDetailsFn = (indexName: string, tab?: IndexDetailTab) => void;
