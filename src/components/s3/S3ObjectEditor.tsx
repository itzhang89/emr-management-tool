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
import { sql } from "@codemirror/lang-sql";
import { scala } from "@codemirror/legacy-modes/mode/clike";
import { json } from "@codemirror/legacy-modes/mode/javascript";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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
    minHeight: "240px"
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
  }
});

function languageExtensionForKey(fileKey?: string): Extension {
  const extension = fileExtension(fileKey);
  switch (extension) {
    case "sql":
      return sql();
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
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
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
