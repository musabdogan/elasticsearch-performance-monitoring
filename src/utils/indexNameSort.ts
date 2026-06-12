/** Sort index names A→Z; names starting with "." (system/hidden) go last. */
export function compareIndexNamesDotLast(a: string, b: string): number {
  const aHidden = a.startsWith('.');
  const bHidden = b.startsWith('.');
  if (aHidden !== bHidden) return aHidden ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function sortIndexNamesDotLast(names: string[]): string[] {
  return [...names].sort(compareIndexNamesDotLast);
}
