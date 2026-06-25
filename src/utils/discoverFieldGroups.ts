import type { DiscoverFieldGroup, DiscoverFieldGroupId } from '@/types/discover';
import type { SearchHit } from '@/types/api';
import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import {
  isDisplayableSourceField,
  isMetaDataField,
  META_FIELD_ID,
  META_FIELD_INDEX,
  sortFieldNames
} from '@/utils/indexDataTable';
import { getLeafFieldNamesFromMapping } from '@/utils/mappingFields';

const POPULAR_LIMIT = 5;

function fieldsFromHits(hits: SearchHit[]): Set<string> {
  const names = new Set<string>();
  for (const hit of hits) {
    const source = hit._source;
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source as Record<string, unknown>)) {
      if (isDisplayableSourceField(key)) names.add(key);
    }
  }
  return names;
}

function mappingLeafFields(
  mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null | undefined
): string[] {
  if (!mappings) return [];
  const names = new Set<string>();
  for (const entry of Object.values(mappings)) {
    for (const name of getLeafFieldNamesFromMapping(entry?.mappings?.properties)) {
      if (isDisplayableSourceField(name)) names.add(name);
    }
  }
  return sortFieldNames([...names]);
}

export function buildDiscoverFieldGroups(input: {
  selectedColumns: string[];
  availableFields: string[];
  hits: SearchHit[];
  fieldUsageSummary?: FieldUsageSummary | null;
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null;
  nameFilter?: string;
}): DiscoverFieldGroup[] {
  const {
    selectedColumns,
    availableFields,
    hits,
    fieldUsageSummary,
    mappings,
    nameFilter = ''
  } = input;

  const q = nameFilter.trim().toLowerCase();
  const matchesFilter = (field: string) => !q || field.toLowerCase().includes(q);

  const selectedSet = new Set(
    selectedColumns.filter((f) => isDisplayableSourceField(f) && matchesFilter(f))
  );

  const metaFields = sortFieldNames(
    [META_FIELD_ID, META_FIELD_INDEX].filter(matchesFilter)
  );

  /** Top fields by query usage (_field_usage_stats); omit group when none. */
  const popular = (
    fieldUsageSummary?.fieldList
      ?.filter((f) => f.usage > 0 && isDisplayableSourceField(f.name) && !isMetaDataField(f.name))
      .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
      .slice(0, POPULAR_LIMIT)
      .map((f) => f.name)
      .filter(matchesFilter) ?? []
  );

  const hitFieldSet = fieldsFromHits(hits);
  const mappingFields = mappingLeafFields(mappings);
  const allKnown = new Set<string>([
    ...availableFields,
    ...mappingFields,
    ...hitFieldSet,
    ...popular
  ]);

  const available = sortFieldNames(
    [...allKnown].filter((field) => {
      if (isMetaDataField(field)) return false;
      if (selectedSet.has(field)) return false;
      if (popular.includes(field)) return false;
      return true;
    })
  ).filter(matchesFilter);

  const selected = sortFieldNames([...selectedSet]);

  const groups: Array<{ id: DiscoverFieldGroupId; label: string; fields: string[] }> = [
    { id: 'selected', label: 'Selected fields', fields: selected },
    { id: 'popular', label: 'Popular fields', fields: popular.filter((f) => !selectedSet.has(f)) },
    { id: 'available', label: 'Available fields', fields: available },
    { id: 'meta', label: 'Meta fields', fields: metaFields.filter((f) => !selectedSet.has(f)) }
  ];

  return groups.filter((g) => g.fields.length > 0 || g.id === 'selected');
}
