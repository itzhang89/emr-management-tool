export type SearchMatch = {
  start: number;
  end: number;
};

export const MAX_LOG_SEARCH_MATCHES = 1_000;
const HIGHLIGHT_WINDOW = 25;

export function buildSearchResult(
  text: string,
  query: string,
  regexSearch: boolean
): { matches: SearchMatch[]; error?: string; truncated?: boolean } {
  if (!query) return { matches: [] };
  if (!regexSearch) {
    return findPlainTextMatches(text, query);
  }

  try {
    return findRegexMatches(text, query);
  } catch {
    return { matches: [], error: "Invalid regex" };
  }
}

function findPlainTextMatches(text: string, query: string) {
  const matches: SearchMatch[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let start = lowerText.indexOf(lowerQuery);

  while (start !== -1) {
    const end = start + query.length;
    matches.push({ start, end });
    if (matches.length >= MAX_LOG_SEARCH_MATCHES) {
      return { matches, truncated: true };
    }
    start = lowerText.indexOf(lowerQuery, end);
  }

  return { matches };
}

function findRegexMatches(text: string, query: string) {
  const matches: SearchMatch[] = [];
  const regex = new RegExp(query, "gi");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= MAX_LOG_SEARCH_MATCHES) {
      return { matches, truncated: true };
    }
  }

  return { matches };
}

export function formatSearchMatchLabel(
  matchCount: number,
  activeMatchIndex: number,
  options?: { truncated?: boolean; error?: string }
) {
  if (options?.error) return options.error;
  if (matchCount === 0) return "0 / 0";
  const suffix = options?.truncated ? "+" : "";
  return `${activeMatchIndex + 1} / ${matchCount}${suffix}`;
}

export function selectRenderableMatches(matches: SearchMatch[], activeMatchIndex: number) {
  if (matches.length <= HIGHLIGHT_WINDOW * 2 + 1) {
    return { matches, activeIndex: activeMatchIndex };
  }

  const windowStart = Math.max(0, activeMatchIndex - HIGHLIGHT_WINDOW);
  const windowEnd = Math.min(matches.length, activeMatchIndex + HIGHLIGHT_WINDOW + 1);
  return {
    matches: matches.slice(windowStart, windowEnd),
    activeIndex: activeMatchIndex - windowStart
  };
}
