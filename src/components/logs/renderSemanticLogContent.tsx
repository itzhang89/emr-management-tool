import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  classNameForLogSegmentKind,
  segmentLogText,
  type LogSegment
} from "@/services/logSemanticHighlight";
import { selectRenderableMatches, type SearchMatch } from "@/services/logSearch";

export function renderSemanticLogContent(
  text: string,
  matches: SearchMatch[],
  activeMatchIndex: number,
  options?: { semanticHighlight?: boolean }
): ReactNode {
  const semanticHighlight = options?.semanticHighlight ?? true;

  if (!semanticHighlight) {
    return renderSearchOnlyLogContent(text, matches, activeMatchIndex);
  }

  const segments = segmentLogText(text);
  if (segments.length === 0) return text;

  const { matches: visibleMatches, activeIndex } =
    matches.length > 0 ? selectRenderableMatches(matches, activeMatchIndex) : { matches: [], activeIndex: 0 };

  const parts: ReactNode[] = [];
  let key = 0;

  for (const segment of segments) {
    if (segment.kind === "newline") {
      parts.push("\n");
      continue;
    }

    const piece = text.slice(segment.start, segment.end);
    if (!piece) continue;

    const semanticClass = classNameForLogSegmentKind(segment.kind);
    const overlaps = visibleMatches
      .map((match, index) => ({ match, index }))
      .filter(({ match }) => match.start < segment.end && match.end > segment.start)
      .sort((left, right) => left.match.start - right.match.start || left.match.end - right.match.end);

    if (overlaps.length === 0) {
      parts.push(
        <span key={key++} className={semanticClass}>
          {piece}
        </span>
      );
      continue;
    }

    let cursor = segment.start;
    for (const { match, index } of overlaps) {
      if (match.end <= cursor) continue;
      const overlapStart = Math.max(cursor, match.start);
      const overlapEnd = Math.min(segment.end, match.end);
      if (overlapStart > cursor) {
        parts.push(
          <span key={key++} className={semanticClass}>
            {text.slice(cursor, overlapStart)}
          </span>
        );
      }
      if (overlapEnd > overlapStart) {
        const isActive = index === activeIndex;
        parts.push(
          <mark
            key={key++}
            data-testid="log-search-match"
            data-active-log-search-match={isActive ? "true" : undefined}
            className={cn(
              semanticClass,
              isActive ? "bg-yellow-300 text-slate-950" : "bg-yellow-500/50 text-slate-50"
            )}
          >
            {text.slice(overlapStart, overlapEnd)}
          </mark>
        );
      }
      cursor = Math.max(cursor, overlapEnd);
    }
    if (cursor < segment.end) {
      parts.push(
        <span key={key++} className={semanticClass}>
          {text.slice(cursor, segment.end)}
        </span>
      );
    }
  }

  return parts;
}

function renderSearchOnlyLogContent(
  text: string,
  matches: SearchMatch[],
  activeMatchIndex: number
): ReactNode {
  if (matches.length === 0) return text;

  const { matches: visibleMatches, activeIndex } = selectRenderableMatches(matches, activeMatchIndex);
  if (visibleMatches.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  visibleMatches.forEach((match, index) => {
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    const isActive = index === activeIndex;
    parts.push(
      <mark
        key={key++}
        data-testid="log-search-match"
        data-active-log-search-match={isActive ? "true" : undefined}
        className={cn(isActive ? "bg-yellow-300 text-slate-950" : "bg-yellow-500/50 text-slate-50")}
      >
        {text.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

/** Exported for tests — merge coverage of a segment against search matches. */
export function overlappingMatchIndexes(segment: LogSegment, matches: SearchMatch[]) {
  return matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => match.start < segment.end && match.end > segment.start);
}
