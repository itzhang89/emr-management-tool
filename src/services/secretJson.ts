/**
 * Reading a SecretString back into fields. Shared by the Secrets page (which
 * edits them as key/value pairs) and DBHub (which only cares which of its five
 * dial fields a bound secret supplies).
 */

/** First-level JSON object entries only; non-objects become a single synthetic field. */
export function firstLevelSecretFields(
  raw: string
): { kind: "object"; fields: { key: string; value: string }[] } | { kind: "raw"; value: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const fields = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value:
          value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : JSON.stringify(value)
      }));
      return { kind: "object", fields };
    }
  } catch {
    // fall through
  }
  return { kind: "raw", value: raw };
}
