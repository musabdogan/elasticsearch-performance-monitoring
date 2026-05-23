import type { CatAliasRow, CatIndexRow, DataStreamsResponse, IlmExplainResponse } from '@/types/api';
import { getFieldNamesForIndex, type MappingsIndexEntry } from '@/utils/mappingFields';

export type MatchScope = 'index' | 'alias' | 'datastream' | 'field' | 'ilm';

export type QueryScope = MatchScope | 'any';

export interface IndexMetaRecord {
  indexName: string;
  health?: string;
  docsCount: number;
  aliases: string[];
  dataStreams: string[];
  fields: string[];
  ilmPolicy?: string;
}

export interface ParsedTerm {
  scope: QueryScope;
  pattern: string;
  flags: string;
  isRegex: boolean;
}

export type AstNode =
  | { kind: 'term'; term: ParsedTerm }
  | { kind: 'not'; child: AstNode }
  | { kind: 'and'; children: AstNode[] }
  | { kind: 'or'; children: AstNode[] };

export interface TermMatchDetail {
  scopes: MatchScope[];
  matchedAliases: string[];
  matchedDataStreams: string[];
  matchedFields: string[];
  matchedIlmPolicies: string[];
}

export interface IndexMatchResult {
  record: IndexMetaRecord;
  matchedBy: MatchScope[];
  previews: {
    aliases: string[];
    dataStreams: string[];
    fields: string[];
    ilmPolicies: string[];
  };
}

export interface ParseQueryResult {
  ast: AstNode | null;
  error: string | null;
}

export interface EvaluateQueryResult {
  results: IndexMatchResult[];
  error: string | null;
}

const SCOPE_ALIASES: Record<string, QueryScope> = {
  index: 'index',
  alias: 'alias',
  aliases: 'alias',
  datastream: 'datastream',
  datastreams: 'datastream',
  stream: 'datastream',
  field: 'field',
  fields: 'field',
  ilm: 'ilm',
  policy: 'ilm'
};

const regexCache = new Map<string, RegExp>();

function isWordBoundary(s: string, pos: number): boolean {
  if (pos >= s.length) return true;
  return /\s|[()]/.test(s[pos]);
}

function parseTermRaw(raw: string): ParsedTerm {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { scope: 'any', pattern: '', flags: '', isRegex: false };
  }

  let rest = trimmed;
  let scope: QueryScope = 'any';

  const scopeMatch = /^([a-zA-Z_]+)\s*:\s*/.exec(rest);
  if (scopeMatch) {
    const key = scopeMatch[1].toLowerCase();
    const mapped = SCOPE_ALIASES[key];
    if (mapped) {
      scope = mapped;
      rest = rest.slice(scopeMatch[0].length).trim();
    }
  }

  if (rest.startsWith('/')) {
    let end = 1;
    while (end < rest.length) {
      if (rest[end] === '/' && rest[end - 1] !== '\\') break;
      end++;
    }
    if (end >= rest.length) {
      throw new Error(`Unclosed regex in term: ${raw}`);
    }
    const pattern = rest.slice(1, end).replace(/\\\//g, '/');
    const flags = rest.slice(end + 1).trim();
    return { scope, pattern, flags, isRegex: true };
  }

  return { scope, pattern: rest, flags: 'i', isRegex: false };
}

type Token =
  | { type: 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' }
  | { type: 'TERM'; value: string };

function tokenize(query: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  const s = query.trim();
  if (!s) return tokens;

  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (s[i] === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (s.slice(i, i + 3).toUpperCase() === 'AND' && isWordBoundary(s, i + 3)) {
      tokens.push({ type: 'AND' });
      i += 3;
      continue;
    }
    if (s.slice(i, i + 2).toUpperCase() === 'OR' && isWordBoundary(s, i + 2)) {
      tokens.push({ type: 'OR' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 3).toUpperCase() === 'NOT' && isWordBoundary(s, i + 3)) {
      tokens.push({ type: 'NOT' });
      i += 3;
      continue;
    }

    const start = i;
    if (s[i] === '/') {
      i++;
      while (i < s.length) {
        if (s[i] === '/' && s[i - 1] !== '\\') {
          i++;
          while (i < s.length && /[imsu]/.test(s[i])) i++;
          break;
        }
        i++;
      }
    } else {
      while (i < s.length && !/\s/.test(s[i]) && s[i] !== '(' && s[i] !== ')') {
        if (s[i] === '/' && i > start) {
          const maybeScope = s.slice(start, i);
          if (/^[a-zA-Z_]+$/.test(maybeScope) && i + 1 < s.length && s[i + 1] === '/') {
            i++;
            while (i < s.length) {
              if (s[i] === '/' && s[i - 1] !== '\\') {
                i++;
                while (i < s.length && /[imsu]/.test(s[i])) i++;
                break;
              }
              i++;
            }
            break;
          }
        }
        i++;
      }
    }

    if (i === start) {
      return { error: `Unexpected character at position ${start + 1}` };
    }
    tokens.push({ type: 'TERM', value: s.slice(start, i) });
  }

  return tokens;
}

function insertImplicitAnd(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const startsOperand = (t: Token | undefined) =>
    t?.type === 'TERM' || t?.type === 'NOT' || t?.type === 'LPAREN';
  const endsOperand = (t: Token | undefined) =>
    t?.type === 'TERM' || t?.type === 'RPAREN';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (i > 0) {
      const prev = out[out.length - 1];
      if (startsOperand(tok) && endsOperand(prev)) {
        out.push({ type: 'AND' });
      }
    }
    out.push(tok);
  }
  return out;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private match(type: Token['type']): boolean {
    const t = this.peek();
    return t?.type === type;
  }

  parse(): AstNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error('Unexpected tokens after expression');
    }
    return node;
  }

  private parseOr(): AstNode {
    const children: AstNode[] = [this.parseAnd()];
    while (this.match('OR')) {
      this.consume();
      children.push(this.parseAnd());
    }
    if (children.length === 1) return children[0];
    return { kind: 'or', children };
  }

  private parseAnd(): AstNode {
    const children: AstNode[] = [this.parseUnary()];
    while (this.match('AND') || this.match('TERM') || this.match('NOT') || this.match('LPAREN')) {
      if (this.match('AND')) this.consume();
      children.push(this.parseUnary());
    }
    if (children.length === 1) return children[0];
    return { kind: 'and', children };
  }

  private parseUnary(): AstNode {
    if (this.match('NOT')) {
      this.consume();
      return { kind: 'not', child: this.parseUnary() };
    }
    if (this.match('LPAREN')) {
      this.consume();
      const inner = this.parseOr();
      if (!this.match('RPAREN')) throw new Error('Expected closing parenthesis');
      this.consume();
      return inner;
    }
    const t = this.peek();
    if (t?.type !== 'TERM') throw new Error('Expected search term');
    this.consume();
    try {
      return { kind: 'term', term: parseTermRaw(t.value) };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Invalid term');
    }
  }
}

export function parseQuery(query: string): ParseQueryResult {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ast: null, error: null };
  }
  const tokenized = tokenize(trimmed);
  if ('error' in tokenized) {
    return { ast: null, error: tokenized.error };
  }
  try {
    const withAnd = insertImplicitAnd(tokenized);
    const parser = new Parser(withAnd);
    return { ast: parser.parse(), error: null };
  } catch (e) {
    return { ast: null, error: e instanceof Error ? e.message : 'Invalid query' };
  }
}

function getRegex(term: ParsedTerm): RegExp | null {
  if (!term.isRegex) return null;
  const cacheKey = `${term.pattern}\0${term.flags}`;
  const cached = regexCache.get(cacheKey);
  if (cached) return cached;
  try {
    const re = new RegExp(term.pattern, term.flags || undefined);
    regexCache.set(cacheKey, re);
    return re;
  } catch {
    return null;
  }
}

function wildcardToRegex(value: string): RegExp {
  const escaped = value
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

function valueMatches(term: ParsedTerm, value: string): boolean {
  if (!term.pattern) return false;
  if (term.isRegex) {
    const re = getRegex(term);
    if (!re) throw new Error(`Invalid regex: /${term.pattern}/${term.flags}`);
    return re.test(value);
  }
  if (term.pattern.includes('*') || term.pattern.includes('?')) {
    return wildcardToRegex(term.pattern).test(value);
  }
  return value.toLowerCase().includes(term.pattern.toLowerCase());
}

function evaluateTermOnRecord(term: ParsedTerm, record: IndexMetaRecord): TermMatchDetail | null {
  const scopesToCheck: MatchScope[] =
    term.scope === 'any' ? ['index', 'alias', 'datastream', 'field', 'ilm'] : [term.scope];

  const matchedAliases: string[] = [];
  const matchedDataStreams: string[] = [];
  const matchedFields: string[] = [];
  const matchedIlmPolicies: string[] = [];
  const scopes: MatchScope[] = [];

  for (const scope of scopesToCheck) {
    if (scope === 'index') {
      if (valueMatches(term, record.indexName)) scopes.push('index');
    } else if (scope === 'alias') {
      for (const a of record.aliases) {
        if (valueMatches(term, a)) matchedAliases.push(a);
      }
      if (matchedAliases.length > 0) scopes.push('alias');
    } else if (scope === 'datastream') {
      for (const ds of record.dataStreams) {
        if (valueMatches(term, ds)) matchedDataStreams.push(ds);
      }
      if (matchedDataStreams.length > 0) scopes.push('datastream');
    } else if (scope === 'field') {
      for (const f of record.fields) {
        if (valueMatches(term, f)) matchedFields.push(f);
      }
      if (matchedFields.length > 0) scopes.push('field');
    } else if (scope === 'ilm') {
      const policy = String(record.ilmPolicy ?? '').trim();
      if (policy && valueMatches(term, policy)) {
        matchedIlmPolicies.push(policy);
        scopes.push('ilm');
      }
    }
  }

  if (scopes.length === 0) return null;

  return {
    scopes,
    matchedAliases: [...new Set(matchedAliases)].slice(0, 5),
    matchedDataStreams: [...new Set(matchedDataStreams)].slice(0, 5),
    matchedFields: [...new Set(matchedFields)].slice(0, 5),
    matchedIlmPolicies: [...new Set(matchedIlmPolicies)].slice(0, 5)
  };
}

function evaluateAst(ast: AstNode, record: IndexMetaRecord): TermMatchDetail | null {
  switch (ast.kind) {
    case 'term': {
      return evaluateTermOnRecord(ast.term, record);
    }
    case 'not': {
      const inner = evaluateAst(ast.child, record);
      return inner
        ? null
        : { scopes: [], matchedAliases: [], matchedDataStreams: [], matchedFields: [], matchedIlmPolicies: [] };
    }
    case 'and': {
      const parts: TermMatchDetail[] = [];
      for (const child of ast.children) {
        const r = evaluateAst(child, record);
        if (!r) return null;
        parts.push(r);
      }
      return mergeMatchDetails(parts);
    }
    case 'or': {
      const parts: TermMatchDetail[] = [];
      for (const child of ast.children) {
        const r = evaluateAst(child, record);
        if (r) parts.push(r);
      }
      if (parts.length === 0) return null;
      return mergeMatchDetails(parts);
    }
  }
}

function mergeMatchDetails(parts: TermMatchDetail[]): TermMatchDetail {
  const scopes = new Set<MatchScope>();
  const matchedAliases: string[] = [];
  const matchedDataStreams: string[] = [];
  const matchedFields: string[] = [];
  const matchedIlmPolicies: string[] = [];
  for (const p of parts) {
    for (const s of p.scopes) scopes.add(s);
    matchedAliases.push(...p.matchedAliases);
    matchedDataStreams.push(...p.matchedDataStreams);
    matchedFields.push(...p.matchedFields);
    matchedIlmPolicies.push(...p.matchedIlmPolicies);
  }
  return {
    scopes: [...scopes],
    matchedAliases: [...new Set(matchedAliases)].slice(0, 5),
    matchedDataStreams: [...new Set(matchedDataStreams)].slice(0, 5),
    matchedFields: [...new Set(matchedFields)].slice(0, 5),
    matchedIlmPolicies: [...new Set(matchedIlmPolicies)].slice(0, 5)
  };
}

function detailToResult(record: IndexMetaRecord, detail: TermMatchDetail): IndexMatchResult {
  return {
    record,
    matchedBy: detail.scopes,
    previews: {
      aliases: detail.matchedAliases,
      dataStreams: detail.matchedDataStreams,
      fields: detail.matchedFields,
      ilmPolicies: detail.matchedIlmPolicies
    }
  };
}

function compareRecordsByDefaultOrder(a: IndexMetaRecord, b: IndexMetaRecord): number {
  if (b.docsCount !== a.docsCount) return b.docsCount - a.docsCount;
  return a.indexName.localeCompare(b.indexName, undefined, { numeric: true });
}

export function evaluateQuery(
  ast: AstNode | null,
  records: IndexMetaRecord[]
): EvaluateQueryResult {
  if (!ast) {
    return { results: [], error: null };
  }
  try {
    const results: IndexMatchResult[] = [];
    for (const record of records) {
      const detail = evaluateAst(ast, record);
      if (!detail) continue;
      results.push(detailToResult(record, detail));
    }
    results.sort((a, b) => compareRecordsByDefaultOrder(a.record, b.record));
    return { results, error: null };
  } catch (e) {
    return { results: [], error: e instanceof Error ? e.message : 'Evaluation failed' };
  }
}

export function buildIndexMetaCache(
  catalog: CatIndexRow[],
  aliases: CatAliasRow[],
  dataStreamsRes: DataStreamsResponse | null | undefined,
  mappings: Record<string, MappingsIndexEntry> | null | undefined,
  ilmExplain: IlmExplainResponse | null | undefined
): IndexMetaRecord[] {
  const indexToAliases = new Map<string, Set<string>>();
  for (const row of aliases) {
    const indexName = String(row.index ?? '').trim();
    const aliasName = String(row.alias ?? '').trim();
    if (!indexName || !aliasName) continue;
    const set = indexToAliases.get(indexName) ?? new Set<string>();
    set.add(aliasName);
    indexToAliases.set(indexName, set);
  }

  const indexToDataStreams = new Map<string, Set<string>>();
  for (const ds of dataStreamsRes?.data_streams ?? []) {
    const streamName = String(ds.name ?? '').trim();
    if (!streamName) continue;
    for (const idx of ds.indices ?? []) {
      const indexName = String(idx.index_name ?? '').trim();
      if (!indexName) continue;
      const set = indexToDataStreams.get(indexName) ?? new Set<string>();
      set.add(streamName);
      indexToDataStreams.set(indexName, set);
    }
  }

  const indexNames = new Set<string>();
  for (const row of catalog) {
    const name = String(row.index ?? '').trim();
    if (name) indexNames.add(name);
  }
  if (mappings) {
    for (const k of Object.keys(mappings)) {
      if (k !== '_shards') indexNames.add(k);
    }
  }
  if (ilmExplain?.indices) {
    for (const name of Object.keys(ilmExplain.indices)) {
      if (name) indexNames.add(name);
    }
  }

  const records: IndexMetaRecord[] = [];
  const healthByIndex = new Map<string, string>();
  for (const row of catalog) {
    const name = String(row.index ?? '').trim();
    if (name && row.health) healthByIndex.set(name, String(row.health));
  }

  for (const indexName of [...indexNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const catalogRow = catalog.find((r) => String(r.index ?? '').trim() === indexName);
    const rawDocsCount = String(catalogRow?.['docs.count'] ?? '').replace(/,/g, '');
    const docsCountParsed = parseInt(rawDocsCount, 10);
    records.push({
      indexName,
      health: healthByIndex.get(indexName),
      docsCount: Number.isFinite(docsCountParsed) && docsCountParsed >= 0 ? docsCountParsed : 0,
      aliases: [...(indexToAliases.get(indexName) ?? [])].sort(),
      dataStreams: [...(indexToDataStreams.get(indexName) ?? [])].sort(),
      fields: getFieldNamesForIndex(indexName, mappings),
      ilmPolicy: ilmExplain?.indices?.[indexName]?.policy ?? ilmExplain?.indices?.[indexName]?.phase_execution?.policy
    });
  }

  return records.sort(compareRecordsByDefaultOrder);
}

export function runRegexQuery(
  query: string,
  records: IndexMetaRecord[]
): { results: IndexMatchResult[]; parseError: string | null; evalError: string | null } {
  const { ast, error: parseError } = parseQuery(query);
  if (parseError) {
    return { results: [], parseError, evalError: null };
  }
  const { results, error: evalError } = evaluateQuery(ast, records);
  return { results, parseError: null, evalError };
}
