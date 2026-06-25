export type DiscoverFilter = {
  id: string;
  /** Display field name (e.g. hostname). */
  field: string;
  /** Elasticsearch field for match_phrase (e.g. hostname.keyword). */
  aggField: string;
  value: string | number | boolean;
  /** When true, applied as bool.must_not. */
  negate?: boolean;
};

export type DiscoverFieldGroupId =
  | 'selected'
  | 'popular'
  | 'available'
  | 'meta';

export type DiscoverFieldGroup = {
  id: DiscoverFieldGroupId;
  label: string;
  fields: string[];
};

export type FieldTopValueBucket = {
  key: string;
  docCount: number;
  percent: number;
};

export type FieldTopValuesResult = {
  kind: 'terms' | 'date_histogram';
  field: string;
  /** Documents in the sampler bucket (for footer + percent denominators). */
  sampleSize: number;
  distinctCount: number | null;
  buckets: FieldTopValueBucket[];
};
