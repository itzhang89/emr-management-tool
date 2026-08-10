import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";
import { formatSearchMatchLabel } from "@/services/logSearch";

export const MAX_S3_SEARCH_MATCHES = 1_000;

export type SearchMatchRange = {
  from: number;
  to: number;
};

export function collectSearchMatches(
  state: EditorState,
  query: SearchQuery,
  maxMatches = MAX_S3_SEARCH_MATCHES
): { matches: SearchMatchRange[]; truncated: boolean } {
  if (!query.valid) {
    return { matches: [], truncated: false };
  }

  const matches: SearchMatchRange[] = [];
  const cursor = query.getCursor(state);
  let step = cursor.next();

  while (!step.done) {
    matches.push({ from: step.value.from, to: step.value.to });
    if (matches.length >= maxMatches) {
      return { matches, truncated: true };
    }
    step = cursor.next();
  }

  return { matches, truncated: false };
}

export function findActiveMatchIndex(
  matches: SearchMatchRange[],
  selectionFrom: number,
  selectionTo: number
): number {
  if (matches.length === 0) return -1;

  const exact = matches.findIndex(
    (match) => match.from === selectionFrom && match.to === selectionTo
  );
  if (exact >= 0) return exact;

  const overlapping = matches.findIndex(
    (match) => match.from <= selectionFrom && match.to >= selectionTo && selectionFrom !== selectionTo
  );
  if (overlapping >= 0) return overlapping;

  const atOrAfter = matches.findIndex((match) => match.from >= selectionFrom);
  return atOrAfter >= 0 ? atOrAfter : matches.length - 1;
}

export function formatS3SearchMatchLabel(
  matchCount: number,
  activeMatchIndex: number,
  options?: { truncated?: boolean; error?: string; emptyQuery?: boolean }
) {
  if (options?.emptyQuery) return "";
  if (options?.error) return options.error;
  return formatSearchMatchLabel(matchCount, Math.max(0, activeMatchIndex), {
    truncated: options?.truncated,
    error: options?.error
  });
}
