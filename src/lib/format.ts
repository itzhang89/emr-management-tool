/** A readable short duration, e.g. "840 ms", "2.4 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Pretty-printed JSON for display. `undefined`/`null` render as `{}` so every
 * value has a stable, copyable form; a value that cannot be serialized (e.g. a
 * circular object) falls back to its string form rather than throwing.
 */
export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}
