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
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
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
    maxWidth: "min(420px, calc(100% - 16px))",
    zIndex: "40",
    backgroundColor: "transparent",
    color: "var(--color-popover-foreground)",
    borderBottom: "none",
    boxShadow: "none"
  },
  ".cm-panel.cm-search": {
    padding: "8px 28px 8px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    backgroundColor: "color-mix(in srgb, var(--color-popover) 96%, transparent)",
    color: "var(--color-popover-foreground)",
    boxShadow: "0 8px 24px color-mix(in srgb, var(--color-foreground) 12%, transparent)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "1.3",
    "& [name=close]": {
      top: "6px",
      right: "8px",
      color: "var(--color-muted-foreground)",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1"
    },
    "& [name=close]:hover": {
      color: "var(--color-foreground)"
    },
    "& input, & button, & label": {
      margin: "0 6px 4px 0"
    },
    "& label": {
      fontSize: "11px",
      color: "var(--color-muted-foreground)",
      display: "inline-flex",
      alignItems: "center",
      gap: "0.25rem"
    },
    "& input[type=checkbox]": {
      marginRight: "0.25rem",
      accentColor: "var(--color-primary)"
    }
  },
  ".cm-textfield": {
    border: "1px solid var(--color-input)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 8px",
    minHeight: "26px",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
    outline: "none",
    fontSize: "12px",
    fontFamily: "var(--font-sans)"
  },
  ".cm-textfield:focus": {
    borderColor: "var(--color-ring)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-ring) 25%, transparent)"
  },
  ".cm-button": {
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 8px",
    minHeight: "26px",
    backgroundColor: "var(--color-secondary)",
    color: "var(--color-secondary-foreground)",
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "var(--font-sans)",
    boxShadow: "none"
  },
  ".cm-button:hover": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)"
  },
  ".cm-button:active": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 85%, var(--color-foreground) 15%)"
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
    fileKey?: string;
    readOnly?: boolean;
    className?: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    onFocusList?: () => void;
    onReadOnlyInput?: () => void;
  }
>(function S3ObjectEditor(
  { value, fileKey, readOnly = false, className, onChange, onSave, onFocusList, onReadOnlyInput },
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
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
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
