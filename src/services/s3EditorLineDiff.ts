export type LineChangeKind = "added" | "modified" | "deleted-before";

export type LineChangeMarker = {
  /** 1-based line number in the current document */
  line: number;
  kind: LineChangeKind;
};

type Anchor = { oldIndex: number; newIndex: number };

export function splitEditorLines(text: string): string[] {
  if (text.length === 0) return [""];
  return text.split("\n");
}

function nonEmptyEntries(lines: string[]) {
  const entries: { index: number; text: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "") {
      entries.push({ index, text: lines[index]! });
    }
  }
  return entries;
}

/** LCS over non-empty lines only — blanks are handled inside gaps. */
function matchNonEmptyAnchors(oldLines: string[], newLines: string[]): Anchor[] {
  const oldEntries = nonEmptyEntries(oldLines);
  const newEntries = nonEmptyEntries(newLines);
  const n = oldEntries.length;
  const m = newEntries.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (oldEntries[i]!.text === newEntries[j]!.text) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const anchors: Anchor[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldEntries[i]!.text === newEntries[j]!.text) {
      anchors.push({ oldIndex: oldEntries[i]!.index, newIndex: newEntries[j]!.index });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return anchors;
}

function markGap(
  oldSlice: string[],
  newSlice: string[],
  newStartIndex: number,
  nextNewAnchorLine: number | null,
  kindByLine: Map<number, LineChangeKind>
) {
  const oldLen = oldSlice.length;
  const newLen = newSlice.length;

  if (newLen > oldLen) {
    const added = newLen - oldLen;
    // Attribute extra lines to the start of the gap (right after previous content).
    for (let offset = 0; offset < added; offset += 1) {
      kindByLine.set(newStartIndex + offset + 1, "added");
    }
    for (let offset = 0; offset < oldLen; offset += 1) {
      if (oldSlice[offset] !== newSlice[added + offset]) {
        kindByLine.set(newStartIndex + added + offset + 1, "modified");
      }
    }
    return;
  }

  if (oldLen > newLen) {
    const anchorLine = nextNewAnchorLine ?? Math.max(1, newStartIndex + Math.max(newLen, 0));
    if (!kindByLine.has(anchorLine)) {
      kindByLine.set(anchorLine, "deleted-before");
    }
    for (let offset = 0; offset < newLen; offset += 1) {
      if (oldSlice[offset] !== newSlice[offset]) {
        kindByLine.set(newStartIndex + offset + 1, "modified");
      }
    }
    return;
  }

  for (let offset = 0; offset < newLen; offset += 1) {
    if (oldSlice[offset] !== newSlice[offset]) {
      kindByLine.set(newStartIndex + offset + 1, "modified");
    }
  }
}

/**
 * Prefer anchoring on non-empty lines, then diff gaps. Blank-line inserts are
 * attributed to the start of the gap (IDEA-like Enter after content).
 */
export function computeLineChangeMarkers(baseline: string, current: string): LineChangeMarker[] {
  if (baseline === current) return [];

  const oldLines = splitEditorLines(baseline);
  const newLines = splitEditorLines(current);
  const anchors = matchNonEmptyAnchors(oldLines, newLines);
  const kindByLine = new Map<number, LineChangeKind>();

  let oldPos = 0;
  let newPos = 0;

  for (const anchor of anchors) {
    markGap(
      oldLines.slice(oldPos, anchor.oldIndex),
      newLines.slice(newPos, anchor.newIndex),
      newPos,
      anchor.newIndex + 1,
      kindByLine
    );
    oldPos = anchor.oldIndex + 1;
    newPos = anchor.newIndex + 1;
  }

  markGap(oldLines.slice(oldPos), newLines.slice(newPos), newPos, null, kindByLine);

  const anchoredNew = new Set(anchors.map((anchor) => anchor.newIndex));
  for (let index = 0; index < newLines.length; index += 1) {
    if (newLines[index] === "") continue;
    if (anchoredNew.has(index)) continue;
    if (!kindByLine.has(index + 1)) {
      kindByLine.set(index + 1, "added");
    }
  }

  return [...kindByLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, kind]) => ({ line, kind }));
}
