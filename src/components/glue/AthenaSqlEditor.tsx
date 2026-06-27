import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  drawSelection,
  highlightActiveLine,
  tooltips
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { sql, SQLDialect } from "@codemirror/lang-sql";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { lineNumberToPosition, parseAthenaErrorLine } from "@/services/athenaSqlErrors";
import { createSqlCompletion, type SqlCatalogContext } from "@/services/athenaSqlCompletion";
import { analyzeSql, type SqlLintOptions } from "@/services/sqlLint";

const athenaDialect = SQLDialect.define({
  keywords:
    "select from where group by order having limit join left right inner outer cross on as and or not in is null distinct create drop alter table database view insert update delete truncate msck repair"
});

const sqlHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "hsl(221.2 83.2% 53.3%)", fontWeight: "600" },
  { tag: t.operator, color: "hsl(222.2 47.4% 35%)" },
  { tag: t.number, color: "hsl(25 95% 45%)" },
  { tag: [t.string, t.special(t.string)], color: "hsl(142 76% 36%)" },
  { tag: t.comment, color: "hsl(215.4 16.3% 46.9%)", fontStyle: "italic" },
  { tag: t.typeName, color: "hsl(271 81% 56%)" },
  { tag: t.propertyName, color: "hsl(199 89% 38%)" },
  { tag: t.variableName, color: "hsl(199 89% 38%)" },
  { tag: t.function(t.variableName), color: "hsl(199 89% 38%)" },
  { tag: t.punctuation, color: "hsl(215.4 16.3% 46.9%)" },
  { tag: t.invalid, color: "hsl(0 84.2% 60.2%)" }
]);

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
    height: "100%",
    minHeight: "140px"
  },
  ".cm-editor": {
    height: "100%",
    minHeight: "140px"
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit"
  },
  "&.cm-focused": {
    outline: "2px solid color-mix(in srgb, var(--color-ring) 35%, transparent)",
    outlineOffset: "-1px"
  },
  ".cm-content": {
    padding: "8px 0",
    minHeight: "124px",
    caretColor: "var(--color-foreground)"
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-muted)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--color-muted) 85%, var(--color-foreground) 15%)"
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--color-muted) 65%, transparent)"
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--color-destructive)"
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid hsl(45 93% 47%)"
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)"
  }
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
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onRunNewTabRef = useRef(onRunNewTab);
  const lintOptionsRef = useRef<SqlLintOptions>({ selectedDatabase });
  const catalogContextRef = useRef(catalogContext);
  const executionErrorRef = useRef(executionError);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onRunNewTabRef.current = onRunNewTab;
  lintOptionsRef.current = { selectedDatabase };
  catalogContextRef.current = catalogContext;
  executionErrorRef.current = executionError;

  const compartments = useMemo(
    () => ({
      lint: new Compartment(),
      completion: new Compartment(),
      execution: new Compartment(),
      readOnly: new Compartment()
    }),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const runQuery = (view: EditorView, openNewTab: boolean) => {
      const sql = view.state.doc.toString();
      if (openNewTab) {
        onRunNewTabRef.current?.(sql);
      } else {
        onRunRef.current?.(sql);
      }
      return true;
    };

    const runKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-Shift-Enter",
          run: (view) => runQuery(view, true)
        },
        {
          key: "Mod-Enter",
          run: (view) => runQuery(view, false)
        }
      ])
    );

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      onChangeRef.current(update.state.doc.toString());
    });

    const extensions: Extension[] = [
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      runKeymap,
      sql({ dialect: athenaDialect, upperCaseKeywords: true }),
      syntaxHighlighting(sqlHighlightStyle),
      tooltips({ parent: document.body }),
      editorTheme,
      lintGutter(),
      compartments.lint.of(createSqlLinter(() => lintOptionsRef.current)),
      compartments.execution.of(createExecutionErrorLinter(() => executionErrorRef.current)),
      compartments.completion.of(
        autocompletion({
          activateOnTyping: true,
          override: [createSqlCompletion(() => catalogContextRef.current)]
        })
      ),
      compartments.readOnly.of(EditorState.readOnly.of(false)),
      updateListener,
      placeholderExt("Write Athena SQL here…")
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions
      }),
      parent: containerRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        compartments.lint.reconfigure(createSqlLinter(() => lintOptionsRef.current)),
        compartments.completion.reconfigure(
          autocompletion({
            activateOnTyping: true,
            override: [createSqlCompletion(() => catalogContextRef.current)]
          })
        )
      ]
    });
  }, [catalogContext, selectedDatabase, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.execution.reconfigure(createExecutionErrorLinter(() => executionErrorRef.current))
    });
  }, [executionError, compartments.execution]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly))
    });
  }, [readOnly, compartments.readOnly]);

  return (
    <div
      ref={containerRef}
      className={cn("athena-sql-editor min-h-[140px] shrink-0 rounded-lg border bg-background", className)}
    />
  );
}
