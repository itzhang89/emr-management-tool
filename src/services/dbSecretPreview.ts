import { firstLevelSecretFields } from "@/services/secretJson";

/**
 * What a bound Secrets Manager secret will actually hand the dialer.
 *
 * The rules mirror the Rust side that does the real work — `parse_db_secret_json`
 * and `apply_db_secret_overlay` in `src-tauri/src/aws/secrets_manager.rs` — so the
 * form can say which fields a secret supplies *before* anything is saved. A field
 * this module calls absent is one the overlay would skip too.
 */

/** The five dial fields a bound secret may supply, in the order the form lists them. */
export const DB_SECRET_FIELDS = ["host", "port", "database", "username", "password"] as const;
export type DbSecretField = (typeof DB_SECRET_FIELDS)[number];

export type DbSecretFieldRow = {
  key: DbSecretField;
  present: boolean;
  /** Display value. Never set for `password` — that one is present-or-not, never shown. */
  value?: string;
};

export type DbSecretPreview =
  /** The secret's value could not be read as a JSON object (no permission, binary, not JSON). */
  | { status: "unreadable" }
  | { status: "ok"; rows: DbSecretFieldRow[] };

/** The port the overlay would accept; anything else is treated as not supplied. */
function usablePort(value: string): boolean {
  const port = Number(value.trim());
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

export function readDbSecretPreview(raw: string): DbSecretPreview {
  const parsed = firstLevelSecretFields(raw);
  if (parsed.kind !== "object") return { status: "unreadable" };

  const byKey = new Map(parsed.fields.map((field) => [field.key, field.value]));
  const rows = DB_SECRET_FIELDS.map((key): DbSecretFieldRow => {
    const value = byKey.get(key);
    const present = value !== undefined && value.trim() !== "" && (key !== "port" || usablePort(value));
    if (!present) return { key, present: false };
    // The password is the one field the form must not carry: knowing it is
    // there is what the panel needs, and the value stays out of the WebView's
    // render path (the dialer reads it in Rust).
    return key === "password" ? { key, present: true } : { key, present: true, value: value!.trim() };
  });

  return { status: "ok", rows };
}

/**
 * Which of the five fields a readable preview says the secret supplies. A
 * missing preview (none chosen yet, or still loading) supplies nothing — the
 * form then asks for everything, which is never wrong, only more typing.
 */
export function providedSecretFields(preview: DbSecretPreview | undefined): Set<DbSecretField> {
  if (!preview || preview.status !== "ok") return new Set();
  return new Set(preview.rows.filter((row) => row.present).map((row) => row.key));
}

/** The value of one supplied field, or undefined when the secret does not supply it. */
export function secretFieldValue(
  preview: DbSecretPreview | undefined,
  key: DbSecretField
): string | undefined {
  if (!preview || preview.status !== "ok") return undefined;
  return preview.rows.find((row) => row.key === key && row.present)?.value;
}
