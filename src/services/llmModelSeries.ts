/**
 * Grouping model ids into series for the Providers model tree.
 *
 * `claude-opus-4-8` → `claude-opus`, `gpt-5.6-sol` → `gpt-5.6-sol`. The rule is
 * a heuristic over hyphen-separated segments: trailing version-looking segments
 * are dropped, and what remains is the series. It is deliberately a guess — the
 * "add model" dialog lets the user override the series, because no rule covers
 * every gateway's naming.
 *
 * Mirrors `src-tauri/src/chat/model_series.rs`, which is what runs during a
 * sync import; this copy exists so the UI can preview the series as the user
 * types a model id. The test cases are kept in sync between the two.
 */

const VERSION_WORDS = new Set(["latest", "preview", "beta", "exp"]);

/**
 * True for segments that read as a version rather than part of a name: pure
 * digits (`4`, `8`), dotted numbers (`3.5`), date stamps (`20250219`), and the
 * `latest` / `preview` style suffixes gateways append.
 */
function isVersionSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  const lower = segment.toLowerCase();
  if (VERSION_WORDS.has(lower)) return true;
  return /^[0-9.]+$/.test(lower) && /[0-9]/.test(lower);
}

/**
 * The series a model id belongs to. Never empty: a model id made only of
 * version segments (`gpt-4`) keeps its first segment.
 */
export function modelSeries(modelId: string): string {
  const trimmed = modelId.trim();
  // Gateways often namespace ids as `vendor/model`; the path prefix is not part
  // of the series name users recognise.
  const bare = trimmed.split("/").pop() ?? trimmed;
  const segments = bare.split("-").filter((segment) => segment.length > 0);
  if (segments.length === 0) return trimmed;

  let end = segments.length;
  while (end > 1 && isVersionSegment(segments[end - 1]!)) {
    end -= 1;
  }

  return segments.slice(0, end).join("-");
}

/** Groups models by series, preserving the order series first appear in. */
export function groupBySeries<T extends { series: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const existing = groups.get(item.series);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.series, [item]);
    }
  }
  return [...groups.entries()];
}
