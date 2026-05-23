export function normalizeSearchText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export type ParsedSearchTerms = {
  includeTerms: string[];
  excludeTerms: string[];
};

export function parseSearchTerms(query: string | null | undefined): ParsedSearchTerms {
  const rawTokens = String(query ?? '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const includeTerms: string[] = [];
  const excludeTerms: string[] = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    const token = rawTokens[i];
    if (token === 'NOT') {
      const next = rawTokens[i + 1];
      if (next && next !== 'NOT') {
        const normalized = normalizeSearchText(next);
        if (normalized) excludeTerms.push(normalized);
        i += 1;
      }
      continue;
    }
    const normalized = normalizeSearchText(token);
    if (normalized) includeTerms.push(normalized);
  }
  return { includeTerms, excludeTerms };
}

export function hasSearchTerms(parsed: ParsedSearchTerms): boolean {
  return parsed.includeTerms.length > 0 || parsed.excludeTerms.length > 0;
}

export function matchesParsedTermsInText(text: string | null | undefined, parsed: ParsedSearchTerms): boolean {
  const normalized = normalizeSearchText(text);
  const includeMatches = parsed.includeTerms.every((term) => normalized.includes(term));
  const excludeMatches = parsed.excludeTerms.every((term) => !normalized.includes(term));
  return includeMatches && excludeMatches;
}

export function matchesParsedTermsInAnyText(
  texts: Array<string | null | undefined>,
  parsed: ParsedSearchTerms
): boolean {
  const normalizedTexts = texts.map((text) => normalizeSearchText(text));
  const includeMatches = parsed.includeTerms.every((term) => normalizedTexts.some((text) => text.includes(term)));
  const excludeMatches = parsed.excludeTerms.every((term) => normalizedTexts.every((text) => !text.includes(term)));
  return includeMatches && excludeMatches;
}
