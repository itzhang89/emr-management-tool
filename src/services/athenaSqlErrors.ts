export function parseAthenaErrorLine(message?: string): number | undefined {
  if (!message) return undefined;

  const lineMatch = message.match(/\bline\s+(\d+)\b/i);
  if (lineMatch?.[1]) {
    const line = Number.parseInt(lineMatch[1], 10);
    return Number.isFinite(line) && line > 0 ? line : undefined;
  }

  const columnMatch = message.match(/(?:SYNTAX_ERROR|TYPE_MISMATCH|SCHEMA_NOT_FOUND)[^:]*:\s*line\s+(\d+)/i);
  if (columnMatch?.[1]) {
    const line = Number.parseInt(columnMatch[1], 10);
    return Number.isFinite(line) && line > 0 ? line : undefined;
  }

  return undefined;
}

export function lineNumberToPosition(doc: string, lineNumber: number): { from: number; to: number } | undefined {
  if (lineNumber < 1) return undefined;

  const lines = doc.split("\n");
  if (lineNumber > lines.length) return undefined;

  let from = 0;
  for (let index = 0; index < lineNumber - 1; index += 1) {
    from += lines[index].length + 1;
  }

  const lineText = lines[lineNumber - 1] ?? "";
  return {
    from,
    to: from + Math.max(lineText.length, 1)
  };
}
