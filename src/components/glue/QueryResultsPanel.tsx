import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AthenaQueryExecution, AthenaQueryResults } from "@/types/domain";

function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function QueryResultsPanel({
  execution,
  results,
  loading,
  error,
  onLoadMore,
  hasMore,
  onExport,
  exporting
}: {
  execution?: AthenaQueryExecution;
  results?: AthenaQueryResults;
  loading: boolean;
  error?: unknown;
  onLoadMore: () => void;
  hasMore: boolean;
  onExport: () => void;
  exporting: boolean;
}) {
  if (!execution) {
    return <p className="text-xs text-muted-foreground">Run a query to see results.</p>;
  }

  const dataRows = skipHeaderRow(results);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Status: {execution.state}</span>
          <span>Scanned: {formatBytes(execution.dataScannedBytes)}</span>
          <span>
            Engine time:{" "}
            {execution.engineExecutionTimeMs !== undefined ? `${execution.engineExecutionTimeMs} ms` : "—"}
          </span>
          <span>Rows: {dataRows.length}</span>
        </div>
        {execution.state === "SUCCEEDED" ? (
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={onExport}>
            <Download data-icon="inline-start" />
            Export CSV
          </Button>
        ) : null}
      </div>

      {execution.state === "FAILED" ? (
        <p className="shrink-0 text-xs text-destructive">{execution.stateChangeReason ?? "Query failed."}</p>
      ) : null}

      {loading ? <p className="shrink-0 text-xs text-muted-foreground">Loading results...</p> : null}
      {error ? <p className="shrink-0 text-xs text-destructive">Failed to load query results.</p> : null}

      {execution.state === "SUCCEEDED" && results ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <table className="min-w-full text-[11px]">
            <thead className="sticky top-0 z-10 bg-muted/80 text-left text-[11px] text-muted-foreground">
              <tr>
                {results.columnNames.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(results.columnNames.length, 1)} className="px-3 py-4 text-muted-foreground">
                    Query returned no rows.
                  </td>
                </tr>
              ) : (
                dataRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="max-w-xs truncate px-3 py-1.5 font-mono text-[11px]">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasMore ? (
        <Button type="button" variant="outline" size="sm" className="shrink-0 self-start" onClick={onLoadMore}>
          Load more rows
        </Button>
      ) : null}
    </div>
  );
}

function skipHeaderRow(results?: AthenaQueryResults) {
  if (!results?.rows.length) return [];
  const [first, ...rest] = results.rows;
  const matchesHeader =
    first.length === results.columnNames.length &&
    first.every((value, index) => value === results.columnNames[index]);
  return matchesHeader ? rest : results.rows;
}
