/**
 * Render a result page as CSV.
 *
 * Only what needs quoting gets it, and a quote inside a value is doubled —
 * the rule that keeps a value containing a comma, a quote or a newline from
 * arriving as two values or two rows.
 *
 * This exports the rows the workspace has *loaded*, not every row the query
 * would return: reading the rest would mean re-running the statement once per
 * page, and a `SELECT *` over a large table would hold the app open doing it.
 * The Glue workspace's export is server-side and can therefore reach rows it
 * never loaded; this one says so in its tooltip rather than pretending.
 */
export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.map(cell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column])).join(","));
  }
  return lines.join("\n");
}
