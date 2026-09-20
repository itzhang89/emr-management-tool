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
import { sql, type SQLDialect } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The SQL editor every workspace shares: CodeMirror with the app's theme,
 * line numbers, undo history and the run keymap.
 *
 * What a *dialect* adds on top is the caller's business — Athena passes a
 * linter, an execution-error reporter and a catalog-driven completion source;
 * a JDBC connection passes none of that and gets a plain highlighted editor
 * rather than a degraded copy of Athena's. Both are configured through the
 * optional `diagnostics` / `completion` extensions, which are only compiled
 * when supplied.
 */

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
  // Height rules must target &.cm-editor only — tooltips({ parent: document.body })
  // mounts a sibling wrapper on <body> that shares theme classes but not .cm-editor.
  "&.cm-editor": {
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
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

export function SqlEditor({
  value,
  onChange,
  onRun,
  onRunNewTab,
  dialect,
  placeholder,
  diagnostics,
  completion,
  className,
  readOnly = false,
  ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  onRun?: (sql: string) => void;
  onRunNewTab?: (sql: string) => void;
  dialect: SQLDialect;
  placeholder?: string;
  /** Linters and gutters for this dialect. Omitted → nothing is compiled. */
  diagnostics?: Extension;
  /** A completion source for this dialect. Omitted → nothing is compiled. */
  completion?: Extension;
  className?: string;
  readOnly?: boolean;
  /**
   * The editor is a contenteditable, not a form control: without an explicit
   * content attribute it has no accessible name, and `getByLabelText` on it
   * stops resolving.
   */
  ariaLabel?: string;
}) {
  const t = useT();
  const placeholderText = placeholder ?? t("Write SQL here…");
  const ariaLabelText = ariaLabel ?? t("SQL editor");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onRunNewTabRef = useRef(onRunNewTab);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onRunNewTabRef.current = onRunNewTab;

  const compartments = useMemo(
    () => ({
      diagnostics: new Compartment(),
      completion: new Compartment(),
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
      sql({ dialect, upperCaseKeywords: true }),
      syntaxHighlighting(sqlHighlightStyle),
      tooltips({ parent: document.body }),
      editorTheme,
      // Filled by the effects below when the caller supplies them; an empty
      // compartment costs nothing and keeps the reconfigure path uniform.
      compartments.diagnostics.of([]),
      compartments.completion.of([]),
      compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
      updateListener,
      EditorView.contentAttributes.of({ "aria-label": ariaLabelText }),
      placeholderExt(placeholderText)
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
    // The editor is built once; dialect, placeholder and readOnly arrive
    // through the compartments below or are fixed for a workspace's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    viewRef.current?.dispatch({
      effects: compartments.diagnostics.reconfigure(diagnostics ?? [])
    });
  }, [diagnostics, compartments.diagnostics]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.completion.reconfigure(completion ?? [])
    });
  }, [completion, compartments.completion]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly))
    });
  }, [readOnly, compartments.readOnly]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "sql-editor min-h-[140px] shrink-0 rounded-lg border bg-background",
        className
      )}
    />
  );
}
