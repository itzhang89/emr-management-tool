import { StateEffect, StateField, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

export const MAX_S3_SEARCH_MATCHES = 1_000;

export type SearchMatchRange = {
  from: number;
  to: number;
};

export const setS3ReplaceMode = StateEffect.define<boolean>();

export const s3ReplaceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setS3ReplaceMode)) return effect.value;
    }
    return value;
  }
});

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
  options?: { truncated?: boolean; error?: string }
) {
  if (options?.error) return options.error;
  if (matchCount <= 0) return "0 Result";
  const suffix = options?.truncated ? "+" : "";
  return `${Math.max(0, activeMatchIndex) + 1}/${matchCount}${suffix}`;
}

export function rangeEquals(a: SearchMatchRange, b: SearchMatchRange) {
  return a.from === b.from && a.to === b.to;
}

export function isRangeExcluded(excluded: SearchMatchRange[], range: SearchMatchRange) {
  return excluded.some((entry) => rangeEquals(entry, range));
}

export function addExcludedRange(excluded: SearchMatchRange[], range: SearchMatchRange) {
  if (isRangeExcluded(excluded, range)) return excluded;
  return [...excluded, range];
}

function unquoteReplace(text: string, literal: boolean) {
  if (literal) return text;
  return text.replace(/\\([nrt\\])/g, (_, ch: string) =>
    ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : "\\"
  );
}

function replacementForMatch(
  state: EditorState,
  query: SearchQuery,
  match: SearchMatchRange
): string {
  if (!query.regexp) {
    return unquoteReplace(query.replace, query.literal);
  }

  const cursor = query.getCursor(state, match.from, match.to);
  const step = cursor.next();
  if (step.done) return query.replace;

  const value = step.value as { from: number; to: number; match?: RegExpExecArray };
  const matched = value.match;
  if (!matched) return query.replace;

  return query.replace.replace(/\$([$&]|\d+)/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return matched[0];
    const index = Number(token);
    return matched[index] ?? whole;
  });
}

export function buildReplaceAllChanges(
  state: EditorState,
  query: SearchQuery,
  excluded: SearchMatchRange[]
): ChangeSpec[] {
  if (!query.valid) return [];
  const { matches } = collectSearchMatches(state, query);
  const changes: ChangeSpec[] = [];

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    if (isRangeExcluded(excluded, match)) continue;
    changes.push({
      from: match.from,
      to: match.to,
      insert: replacementForMatch(state, query, match)
    });
  }

  return changes;
}
