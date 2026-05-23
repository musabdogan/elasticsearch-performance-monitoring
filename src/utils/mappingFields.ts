/** Recursively collect leaf field names (dotted paths) from mapping properties. */
export function getLeafFieldNamesFromMapping(
  props: Record<string, unknown> | undefined,
  prefix = ''
): string[] {
  if (!props || typeof props !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (v.properties) {
      names.push(...getLeafFieldNamesFromMapping(v.properties as Record<string, unknown>, fullPath));
    } else if (v.fields) {
      if (v.type) names.push(fullPath);
      const fields = v.fields as Record<string, unknown>;
      for (const [fk, fv] of Object.entries(fields)) {
        const f = fv as Record<string, unknown>;
        if (f?.properties) {
          names.push(...getLeafFieldNamesFromMapping(f.properties as Record<string, unknown>, `${fullPath}.${fk}`));
        } else {
          names.push(`${fullPath}.${fk}`);
        }
      }
    } else if (v.type) {
      names.push(fullPath);
    }
  }
  return names;
}

export type MappingsIndexEntry = { mappings?: { properties?: Record<string, unknown> } };

export function getFieldNamesForIndex(
  indexName: string,
  mappings: Record<string, MappingsIndexEntry> | null | undefined
): string[] {
  const props = mappings?.[indexName]?.mappings?.properties;
  if (!props) return [];
  return getLeafFieldNamesFromMapping(props);
}
