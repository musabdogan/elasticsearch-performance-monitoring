export type ActiveSearchesDeepLink = {
  indexName?: string;
};

/** Build query string for Indices → Active searches deep link. */
export function buildActiveSearchesUrl(opts?: ActiveSearchesDeepLink): string {
  const params = new URLSearchParams();
  params.set('tab', 'indices');
  params.set('activeSearches', '1');
  const index = opts?.indexName?.trim();
  if (index) params.set('index', index);

  const query = params.toString();

  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`index.html?${query}`);
  }

  const base = window.location.pathname.replace(/\/[^/]*$/, '/index.html');
  return `${window.location.origin}${base}?${query}`;
}

/** Open Active searches in a new browser tab (keeps the current tab/modal as-is). */
export function openActiveSearchesInNewTab(opts?: ActiveSearchesDeepLink): void {
  const url = buildActiveSearchesUrl(opts);

  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export function parseActiveSearchesDeepLink(
  search: string
): { tab: 'indices'; indexName?: string } | null {
  const params = new URLSearchParams(search);
  if (params.get('activeSearches') !== '1') return null;
  const tab = params.get('tab');
  if (tab !== 'indices' && tab !== 'cluster') return null;
  const indexName = params.get('index')?.trim();
  return { tab: 'indices', indexName: indexName || undefined };
}

export function clearActiveSearchesDeepLinkParams(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('activeSearches') !== '1') return;

  params.delete('tab');
  params.delete('activeSearches');
  params.delete('index');
  const remaining = params.toString();
  const next = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}
