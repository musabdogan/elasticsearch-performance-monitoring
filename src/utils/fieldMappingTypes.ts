import type { FieldUsageSummary } from '@/utils/indexDetailHelpers';
import { isMetaDataField, resolveElasticsearchSortField } from '@/utils/indexDataTable';

export type MappingFieldType =
  | 'keyword'
  | 'text'
  | 'date'
  | 'number'
  | 'boolean'
  | 'ip'
  | 'unknown';

const NUMERIC_TYPES = new Set([
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long'
]);

function walkMappingProperties(
  props: Record<string, unknown> | undefined,
  fieldPath: string
): MappingFieldType | null {
  if (!props || !fieldPath) return null;

  const segments = fieldPath.split('.');
  let current: Record<string, unknown> | undefined = props;
  let pathSoFar = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!current) return null;

    const node = current[segment] as Record<string, unknown> | undefined;
    if (!node) return null;

    pathSoFar = pathSoFar ? `${pathSoFar}.${segment}` : segment;

    if (i < segments.length - 1) {
      if (node.properties && typeof node.properties === 'object') {
        current = node.properties as Record<string, unknown>;
        continue;
      }
      if (node.fields && typeof node.fields === 'object') {
        const sub = (node.fields as Record<string, unknown>)[segments[i + 1]];
        if (sub && typeof sub === 'object') {
          return normalizeEsType((sub as Record<string, unknown>).type);
        }
      }
      return null;
    }

    return normalizeEsType(node.type, node);
  }

  return null;
}

function normalizeEsType(
  type: unknown,
  node?: Record<string, unknown>
): MappingFieldType {
  const t = String(type ?? '').toLowerCase();
  if (t === 'keyword') return 'keyword';
  if (t === 'text') {
    if (node?.fields && typeof node.fields === 'object') {
      const fields = node.fields as Record<string, unknown>;
      if ('keyword' in fields) return 'text';
    }
    return 'text';
  }
  if (t === 'date' || t === 'date_nanos') return 'date';
  if (t === 'boolean') return 'boolean';
  if (t === 'ip') return 'ip';
  if (NUMERIC_TYPES.has(t)) return 'number';
  return 'unknown';
}

export function resolveMappingFieldType(
  field: string,
  mappings: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null | undefined
): MappingFieldType {
  if (isMetaDataField(field)) return 'keyword';
  if (field.endsWith('.keyword')) return 'keyword';

  if (!mappings) return 'unknown';

  for (const entry of Object.values(mappings)) {
    const props = entry?.mappings?.properties;
    const found = walkMappingProperties(props, field);
    if (found) return found;
  }

  return 'unknown';
}

export function resolveFieldAggField(
  field: string,
  summary?: FieldUsageSummary | null,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null
): string {
  if (isMetaDataField(field)) return field;

  const mappingType = resolveMappingFieldType(field, mappings);
  if (mappingType === 'keyword' || field.endsWith('.keyword')) {
    return field.endsWith('.keyword') ? field : resolveElasticsearchSortField(field, summary);
  }
  if (mappingType === 'text') {
    return resolveElasticsearchSortField(field, summary);
  }
  if (mappingType === 'date' || mappingType === 'number' || mappingType === 'boolean' || mappingType === 'ip') {
    return field;
  }

  return resolveElasticsearchSortField(field, summary);
}

export function isDateMappingField(
  field: string,
  mappings?: Record<string, { mappings?: { properties?: Record<string, unknown> } }> | null
): boolean {
  return resolveMappingFieldType(field, mappings) === 'date';
}

export function fieldTypeIconLabel(type: MappingFieldType): string {
  switch (type) {
    case 'keyword':
      return 'k';
    case 'text':
      return 't';
    case 'date':
      return 'd';
    case 'number':
      return '#';
    case 'boolean':
      return 'b';
    case 'ip':
      return 'ip';
    default:
      return '?';
  }
}
