/** Build the next conflict-avoidance file name, e.g. report.csv → report (1).csv */
export function nextConflictFileName(fileName: string): string {
  const { stem, extension } = splitFileName(fileName);
  const parsed = parseTrailingConflictIndex(stem);
  const base = parsed?.base ?? stem;
  const index = (parsed?.index ?? 0) + 1;
  return extension ? `${base} (${index}).${extension}` : `${base} (${index})`;
}

export function isValidUploadFileName(fileName: string): boolean {
  const trimmed = fileName.trim();
  if (!trimmed) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  if (trimmed === "." || trimmed === "..") return false;
  return true;
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return { stem: fileName, extension: "" };
  }
  const extension = fileName.slice(lastDot + 1);
  if (extension.includes(" ")) {
    return { stem: fileName, extension: "" };
  }
  return { stem: fileName.slice(0, lastDot), extension };
}

function parseTrailingConflictIndex(stem: string): { base: string; index: number } | undefined {
  const match = /^(.*) \((\d+)\)$/.exec(stem.trimEnd());
  if (!match) return undefined;
  const base = match[1];
  const index = Number(match[2]);
  if (!base || !Number.isFinite(index) || index <= 0) return undefined;
  return { base, index };
}
