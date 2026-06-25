/** Natural A→Z compare (Nodes tab style): numeric segments, case-insensitive. */
const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

export function compareNaturalNames(a: string, b: string): number {
  return naturalNameCollator.compare(a, b);
}

/** Sort index names A→Z; names starting with "." (system/hidden) go last. */
export function compareIndexNamesDotLast(a: string, b: string): number {
  const aHidden = a.startsWith('.');
  const bHidden = b.startsWith('.');
  if (aHidden !== bHidden) return aHidden ? 1 : -1;
  return compareNaturalNames(a, b);
}

export function sortIndexNamesDotLast(names: string[]): string[] {
  return [...names].sort(compareIndexNamesDotLast);
}
