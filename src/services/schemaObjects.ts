import type { DbConnectionKind, SchemaObjectKind } from "@/types/domain";

export interface SchemaObjectOption {
  kind: SchemaObjectKind;
  label: string;
}

/**
 * What each engine's schema can hold, in the order the menu lists them.
 *
 * Tables come first and are the default everywhere: that is what a tree is
 * opened for, and the rest of the list is a deliberate widening.
 */
export function schemaObjectOptions(kind: DbConnectionKind): SchemaObjectOption[] {
  if (kind === "mysql") {
    return [
      { kind: "table", label: "Tables" },
      { kind: "view", label: "Views" },
      { kind: "procedure", label: "Procedures" },
      // Listed because MySQL keeps routines in one catalogue read either way;
      // omitting functions would only leave the user wondering where they went.
      { kind: "function", label: "Functions" },
      { kind: "event", label: "Events" }
    ];
  }
  // Postgres, and Yellowbrick on the same wire.
  return [
    { kind: "table", label: "Tables" },
    { kind: "foreign-table", label: "Foreign Tables" },
    { kind: "view", label: "Views" },
    { kind: "materialized-view", label: "Materialized Views" },
    { kind: "function", label: "Functions" }
  ];
}

/** Tables, and only tables — what the tree shows until asked otherwise. */
export const DEFAULT_SCHEMA_OBJECT_KINDS: SchemaObjectKind[] = ["table"];

/** The kinds a `select … from` can name. A procedure is not one of them. */
export function isRelation(kind: SchemaObjectKind | undefined): boolean {
  return (
    kind === "table" ||
    kind === "view" ||
    kind === "foreign-table" ||
    kind === "materialized-view"
  );
}

/**
 * Quote one identifier the way this engine does.
 *
 * Postgres folds unquoted names to lower case, so a table created as
 * `MyTable` is unreachable without quotes — quoting is how a click can be
 * trusted for any name rather than for the ones that happen to be lowercase.
 * MySQL's backticks are always legal too, so both sides quote unconditionally
 * instead of guessing which names need it.
 */
export function quoteIdentifier(kind: DbConnectionKind, name: string): string {
  return kind === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}
