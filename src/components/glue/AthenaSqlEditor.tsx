import { SQLDialect } from "@codemirror/lang-sql";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";
import { useMemo, useRef } from "react";
import { lineNumberToPosition, parseAthenaErrorLine } from "@/services/athenaSqlErrors";
import { createSqlCompletion, type SqlCatalogContext } from "@/services/athenaSqlCompletion";
import { analyzeSql, type SqlLintOptions } from "@/services/sqlLint";
import { useT } from "@/i18n";
import { SqlEditor } from "@/components/sql/SqlEditor";

/**
 * The Athena SQL editor: the shared [`SqlEditor`] plus everything that is
 * Athena's own — the Hive dialect, the SQL linter, the execution-error
 * reporter and catalog-driven completion.
 *
 * A JDBC connection gets none of those and uses `SqlEditor` directly; keeping
 * the Athena services here rather than in the shared component is what lets
 * both be first-class instead of one being a crippled version of the other.
 */

const hiveDialect = SQLDialect.define({
  keywords:
    "select from where group by order having limit join left right inner outer cross on as and or not in is null distinct create external drop alter table database schema view msck repair describe extended formatted show stored partitioned location serde tblproperties dbproperties comment orc parquet"
});

function createSqlLinter(getOptions: () => SqlLintOptions) {
  return linter((view) => {
    const text = view.state.doc.toString();
    return analyzeSql(text, getOptions()).map(
      (issue): Diagnostic => ({
        from: issue.from,
        to: issue.to,
        severity: issue.severity,
        message: issue.message
      })
    );
  });
}

function createExecutionErrorLinter(getError: () => { message?: string; sql?: string } | undefined) {
  return linter((view) => {
    const failure = getError();
    if (!failure?.message) return [];

    const doc = view.state.doc.toString();
    if (failure.sql && failure.sql.trim() !== doc.trim()) return [];

    const lineNumber = parseAthenaErrorLine(failure.message);
    if (!lineNumber) {
      return [
        {
          from: 0,
          to: Math.max(doc.length, 1),
          severity: "error" as const,
          message: failure.message
        }
      ];
    }

    const range = lineNumberToPosition(doc, lineNumber);
    if (!range) return [];

    return [
      {
        from: range.from,
        to: range.to,
        severity: "error" as const,
        message: failure.message
      }
    ];
  });
}

export function AthenaSqlEditor({
  value,
  onChange,
  onRun,
  onRunNewTab,
  selectedDatabase,
  catalogContext,
  executionError,
  className,
  readOnly = false
}: {
  value: string;
  onChange: (value: string) => void;
  onRun?: (sql: string) => void;
  onRunNewTab?: (sql: string) => void;
  selectedDatabase?: string;
  catalogContext: SqlCatalogContext;
  executionError?: { message?: string; sql?: string };
  className?: string;
  readOnly?: boolean;
}) {
  const t = useT();
  // Both sources read through refs, so the extensions only need rebuilding
  // when their inputs change — never to stay current between those changes.
  const lintOptionsRef = useRef<SqlLintOptions>({ selectedDatabase });
  const catalogContextRef = useRef(catalogContext);
  const executionErrorRef = useRef(executionError);

  lintOptionsRef.current = { selectedDatabase };
  catalogContextRef.current = catalogContext;
  executionErrorRef.current = executionError;

  const diagnostics = useMemo(
    () => [
      lintGutter(),
      createSqlLinter(() => lintOptionsRef.current),
      createExecutionErrorLinter(() => executionErrorRef.current)
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDatabase, executionError]
  );

  const completion = useMemo(
    () =>
      autocompletion({
        activateOnTyping: true,
        override: [createSqlCompletion(() => catalogContextRef.current)]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogContext]
  );

  return (
    <SqlEditor
      value={value}
      onChange={onChange}
      onRun={onRun}
      onRunNewTab={onRunNewTab}
      dialect={hiveDialect}
      placeholder={t("Write Athena SQL here…")}
      diagnostics={diagnostics}
      completion={completion}
      className={className}
      readOnly={readOnly}
    />
  );
}
