import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, tooltips, ViewPlugin } from "@codemirror/view";
import { useEffect, useMemo, useRef, type JSX } from "react";
import { cn } from "@/lib/utils";
import {
  createTemplateVariableCompletion,
  diagnoseUnknownTemplateVariables,
  scanTemplateVariables
} from "@/services/jsonTemplateVariables";

const editorTheme = EditorView.theme({
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
  ".cm-template-variable": {
    color: "hsl(271 81% 56%)",
    fontWeight: "600"
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)"
  }
});

function createVariableExtensions(getKnown: () => string[]): Extension {
  const templateVariableDecoration = Decoration.mark({ class: "cm-template-variable" });
  const templateVariableHighlights = ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: { docChanged: boolean; view: EditorView }) {
        if (update.docChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      private buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const match of scanTemplateVariables(view.state.doc.toString())) {
          builder.add(match.from, match.to, templateVariableDecoration);
        }
        return builder.finish();
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );

  return [
    linter((view) =>
      diagnoseUnknownTemplateVariables(view.state.doc.toString(), getKnown()).map(
        (issue): Diagnostic => ({
          from: issue.from,
          to: issue.to,
          severity: issue.severity,
          message: issue.message
        })
      )
    ),
    templateVariableHighlights,
    autocompletion({
      activateOnTyping: true,
      override: [createTemplateVariableCompletion(getKnown)]
    })
  ];
}

export function JsonTemplateEditor({
  value,
  onChange,
  knownVariables,
  className,
  readOnly = false
}: {
  value: string;
  onChange: (value: string) => void;
  knownVariables: string[];
  className?: string;
  readOnly?: boolean;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const knownRef = useRef(knownVariables);

  onChangeRef.current = onChange;
  knownRef.current = knownVariables;

  const compartments = useMemo(
    () => ({
      variables: new Compartment(),
      readOnly: new Compartment()
    }),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const extensions: Extension[] = [
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      json(),
      linter(jsonParseLinter()),
      lintGutter(),
      tooltips({ parent: document.body }),
      editorTheme,
      compartments.variables.of(createVariableExtensions(() => knownRef.current)),
      compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
      updateListener
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
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
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: compartments.variables.reconfigure(createVariableExtensions(() => knownRef.current))
      });
    }
  }, [knownVariables, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly))
      });
    }
  }, [readOnly, compartments]);

  return (
    <div
      ref={containerRef}
      role="textbox"
      aria-label="Payload JSON"
      aria-multiline="true"
      className={cn("json-template-editor min-h-[140px] shrink-0 rounded-lg border bg-background", className)}
    />
  );
}
