import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine
} from "@codemirror/view";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { scala } from "@codemirror/legacy-modes/mode/clike";
import { json } from "@codemirror/legacy-modes/mode/javascript";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen } from "@codemirror/search";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { createS3SearchPanel } from "@/components/s3/s3SearchPanel";
import { s3ChangeGutter, setS3EditorBaseline } from "@/components/s3/s3ChangeGutter";
import { s3ReplaceModeField, setS3ReplaceMode } from "@/services/s3EditorSearch";
import { cn } from "@/lib/utils";

const highlightStyle = HighlightStyle.define([
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
    minHeight: "240px",
    position: "relative"
  },
  ".cm-editor": {
    height: "100%",
    minHeight: "240px"
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
    minHeight: "224px",
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
  ".cm-panels.cm-panels-top": {
    position: "absolute",
    top: "8px",
    right: "8px",
    left: "auto",
    width: "max-content",
    maxWidth: "min(520px, calc(100% - 16px))",
    zIndex: "40",
    backgroundColor: "transparent",
    color: "var(--color-popover-foreground)",
    borderBottom: "none",
    boxShadow: "none"
  },
  ".cm-panel.cm-search.cm-s3-search": {
    position: "relative",
    padding: "8px 28px 8px 8px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    backgroundColor: "color-mix(in srgb, var(--color-popover) 96%, transparent)",
    color: "var(--color-popover-foreground)",
    boxShadow: "0 8px 24px color-mix(in srgb, var(--color-foreground) 12%, transparent)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "1.3",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: "360px",
    "& [name=close]": {
      position: "absolute",
      top: "6px",
      right: "6px",
      background: "transparent",
      border: "none",
      padding: "0",
      margin: "0",
      color: "var(--color-muted-foreground)",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1"
    },
    "& [name=close]:hover": {
      color: "var(--color-foreground)"
    }
  },
  ".cm-s3-search-row": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "nowrap"
  },
  ".cm-s3-field-shell": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flex: "1 1 auto",
    minWidth: "280px",
    border: "1px solid var(--color-input)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--color-background)",
    padding: "0 4px 0 8px",
    minHeight: "28px"
  },
  ".cm-s3-field-shell:focus-within": {
    borderColor: "var(--color-ring)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-ring) 25%, transparent)"
  },
  ".cm-s3-field-input": {
    flex: "1 1 auto",
    minWidth: "0",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--color-foreground)",
    fontSize: "12px",
    fontFamily: "var(--font-sans)",
    padding: "4px 0",
    margin: "0",
    boxShadow: "none"
  },
  ".cm-s3-field-trailing": {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    flex: "0 0 auto"
  },
  ".cm-s3-opt-btn, .cm-s3-nav-btn": {
    border: "none",
    background: "transparent",
    color: "var(--color-muted-foreground)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    minWidth: "22px",
    height: "22px",
    padding: "0 4px",
    fontSize: "11px",
    fontFamily: "var(--font-sans)",
    lineHeight: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  },
  ".cm-s3-opt-btn:hover, .cm-s3-nav-btn:hover": {
    backgroundColor: "var(--color-muted)",
    color: "var(--color-foreground)"
  },
  ".cm-s3-opt-btn.is-active": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 18%, transparent)",
    color: "var(--color-primary)",
    fontWeight: "600"
  },
  ".cm-s3-search-count": {
    minWidth: "3.75rem",
    padding: "0 4px",
    textAlign: "right",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
    color: "var(--color-muted-foreground)",
    flex: "0 0 auto"
  },
  ".cm-s3-replace-shell": {
    minWidth: "280px"
  },
  ".cm-s3-search-replace .cm-button": {
    flex: "0 0 auto"
  },
  ".cm-button": {
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 8px",
    minHeight: "28px",
    backgroundColor: "var(--color-secondary)",
    color: "var(--color-secondary-foreground)",
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "var(--font-sans)",
    boxShadow: "none",
    margin: "0",
    whiteSpace: "nowrap"
  },
  ".cm-button:hover": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)"
  },
  ".cm-button:active": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 85%, var(--color-foreground) 15%)"
  },
  ".cm-button:disabled": {
    opacity: "0.5",
    cursor: "not-allowed"
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)"
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)"
  }
});

function languageExtensionForKey(fileKey?: string): Extension {
  const extension = fileExtension(fileKey);
  switch (extension) {
    case "sql":
      return sql();
    case "py":
      return python();
    case "scala":
    case "sc":
      return StreamLanguage.define(scala);
    case "json":
      return StreamLanguage.define(json);
    case "yaml":
    case "yml":
      return StreamLanguage.define(yaml);
    case "properties":
    case "conf":
      return StreamLanguage.define(properties);
    default:
      return [];
  }
}

function fileExtension(fileKey?: string) {
  const fileName = fileKey?.split("/").filter(Boolean).at(-1) ?? "";
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index + 1).toLowerCase();
}

export type S3ObjectEditorHandle = {
  focus: () => void;
};

export const S3ObjectEditor = forwardRef<
  S3ObjectEditorHandle,
  {
    value: string;
    /** Content last loaded or saved; used for dirty gutter markers. */
    baseline?: string;
    fileKey?: string;
    readOnly?: boolean;
    className?: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    onFocusList?: () => void;
    onReadOnlyInput?: () => void;
  }
>(function S3ObjectEditor(
  { value, baseline = "", fileKey, readOnly = false, className, onChange, onSave, onFocusList, onReadOnlyInput },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onFocusListRef = useRef(onFocusList);
  const onReadOnlyInputRef = useRef(onReadOnlyInput);
  const readOnlyRef = useRef(readOnly);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onFocusListRef.current = onFocusList;
  onReadOnlyInputRef.current = onReadOnlyInput;
  readOnlyRef.current = readOnly;

  const compartments = useMemo(
    () => ({
      language: new Compartment(),
      readOnly: new Compartment()
    }),
    []
  );

  useImperativeHandle(ref, () => ({
    focus: () => {
      viewRef.current?.focus();
    }
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current?.();
            return true;
          }
        },
        {
          key: "Mod-f",
          run: (view) => {
            if (searchPanelOpen(view.state)) {
              view.dispatch({ effects: setS3ReplaceMode.of(false) });
              return closeSearchPanel(view);
            }
            view.dispatch({ effects: setS3ReplaceMode.of(false) });
            return openSearchPanel(view);
          },
          scope: "editor search-panel"
        },
        {
          key: "Mod-r",
          run: (view) => {
            if (view.state.readOnly) return false;
            view.dispatch({ effects: setS3ReplaceMode.of(true) });
            if (!searchPanelOpen(view.state)) {
              openSearchPanel(view);
            }
            return true;
          },
          scope: "editor search-panel"
        },
        {
          key: "ArrowLeft",
          run: () => {
            onFocusListRef.current?.();
            return true;
          }
        }
      ])
    );

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      onChangeRef.current(update.state.doc.toString());
    });

    const readOnlyHandler = EditorView.domEventHandlers({
      keydown(event) {
        if (!readOnlyRef.current) return false;
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        onReadOnlyInputRef.current?.();
        event.preventDefault();
        return true;
      },
      paste(event) {
        if (!readOnlyRef.current) return false;
        onReadOnlyInputRef.current?.();
        event.preventDefault();
        return true;
      }
    });

    const extensions: Extension[] = [
      lineNumbers(),
      s3ChangeGutter(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      s3ReplaceModeField,
      search({ top: true, createPanel: createS3SearchPanel }),
      history(),
      keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap]),
      saveKeymap,
      compartments.language.of(languageExtensionForKey(fileKey)),
      syntaxHighlighting(highlightStyle, { fallback: true }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      editorTheme,
      readOnlyHandler,
      compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
      updateListener,
      EditorView.contentAttributes.of({ "aria-label": "S3 object content" })
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions
      }),
      parent: containerRef.current
    });

    view.dispatch({ effects: setS3EditorBaseline.of(baseline) });

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
    view.dispatch({ effects: setS3EditorBaseline.of(baseline) });
  }, [baseline]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        compartments.language.reconfigure(languageExtensionForKey(fileKey)),
        compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly))
      ]
    });
  }, [fileKey, readOnly, compartments]);

  return (
    <div
      ref={containerRef}
      className={cn("s3-object-editor min-h-[240px] rounded-lg border bg-background", className)}
    />
  );
});
