export type LineChangeKind = "added" | "modified" | "deleted-before";

export type LineChangeMarker = {
  /** 1-based line number in the current document */
  line: number;
  kind: LineChangeKind;
};

type DiffOp =
  | { type: "equal"; oldIndex: number; newIndex: number }
  | { type: "insert"; newIndex: number }
  | { type: "delete"; oldIndex: number };

export function splitEditorLines(text: string): string[] {
  if (text.length === 0) return [""];
  return text.split("\n");
}

/** LCS-based line diff. Fine for typical editable S3 text sizes. */
export function diffLineOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", oldIndex: i, newIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "delete", oldIndex: i });
      i += 1;
    } else {
      ops.push({ type: "insert", newIndex: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", oldIndex: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "insert", newIndex: j });
    j += 1;
  }
  return ops;
}

export function computeLineChangeMarkers(baseline: string, current: string): LineChangeMarker[] {
  if (baseline === current) return [];

  const oldLines = splitEditorLines(baseline);
  const newLines = splitEditorLines(current);
  const ops = diffLineOps(oldLines, newLines);
  const kindByLine = new Map<number, LineChangeKind>();

  let index = 0;
  while (index < ops.length) {
    if (ops[index]!.type === "equal") {
      index += 1;
      continue;
    }

    const deletes: number[] = [];
    const inserts: number[] = [];
    while (index < ops.length && ops[index]!.type === "delete") {
      deletes.push((ops[index] as Extract<DiffOp, { type: "delete" }>).oldIndex);
      index += 1;
    }
    while (index < ops.length && ops[index]!.type === "insert") {
      inserts.push((ops[index] as Extract<DiffOp, { type: "insert" }>).newIndex);
      index += 1;
    }

    const paired = Math.min(deletes.length, inserts.length);
    for (let pair = 0; pair < paired; pair += 1) {
      kindByLine.set(inserts[pair]! + 1, "modified");
    }
    for (let pair = paired; pair < inserts.length; pair += 1) {
      const line = inserts[pair]! + 1;
      if (!kindByLine.has(line)) kindByLine.set(line, "added");
    }

    const leftoverDeletes = deletes.length - paired;
    if (leftoverDeletes > 0) {
      let anchorLine: number | undefined;
      for (let look = index; look < ops.length; look += 1) {
        const op = ops[look]!;
        if (op.type === "equal" || op.type === "insert") {
          anchorLine = (op.type === "equal" ? op.newIndex : op.newIndex) + 1;
          break;
        }
      }
      if (anchorLine == null) {
        if (inserts.length > 0) {
          anchorLine = inserts[inserts.length - 1]! + 1;
        } else {
          anchorLine = Math.max(1, newLines.length);
        }
      }
      if (!kindByLine.has(anchorLine)) {
        kindByLine.set(anchorLine, "deleted-before");
      }
    }
  }

  return [...kindByLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, kind]) => ({ line, kind }));
}
