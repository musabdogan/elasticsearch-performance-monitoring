export type IndexDetailTab = 'overview' | 'data' | 'mappings' | 'settings' | 'ilm' | 'diagnosis';

export type GlobalIndexModalState = {
  indexName: string;
  tab?: IndexDetailTab;
  searchLatencyFromPoll?: number | null;
};

export type OpenIndexDetailsFn = (indexName: string, tab?: IndexDetailTab, searchLatencyFromPoll?: number | null) => void;
