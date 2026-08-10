import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import {
  computeLineChangeMarkers,
  type LineChangeKind,
  type LineChangeMarker
} from "@/services/s3EditorLineDiff";

export const setS3EditorBaseline = StateEffect.define<string>();

const baselineField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setS3EditorBaseline)) return effect.value;
    }
    return value;
  }
});

const changeMarkersField = StateField.define<Map<number, LineChangeKind>>({
  create(state) {
    return toMarkerMap(computeLineChangeMarkers(state.field(baselineField), state.doc.toString()));
  },
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.effects.some((effect) => effect.is(setS3EditorBaseline))
    ) {
      return toMarkerMap(
        computeLineChangeMarkers(tr.state.field(baselineField), tr.state.doc.toString())
      );
    }
    return value;
  }
});

function toMarkerMap(markers: LineChangeMarker[]) {
  const map = new Map<number, LineChangeKind>();
  for (const marker of markers) {
    map.set(marker.line, marker.kind);
  }
  return map;
}

class ChangeGutterMarker extends GutterMarker {
  constructor(readonly kind: LineChangeKind) {
    super();
  }

  eq(other: ChangeGutterMarker) {
    return other.kind === this.kind;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-s3-change-mark cm-s3-change-${this.kind}`;
    el.title =
      this.kind === "added"
        ? "Added lines"
        : this.kind === "modified"
          ? "Modified lines"
          : "Deleted lines";
    return el;
  }
}

const addedMarker = new ChangeGutterMarker("added");
const modifiedMarker = new ChangeGutterMarker("modified");
const deletedMarker = new ChangeGutterMarker("deleted-before");

function markerForKind(kind: LineChangeKind | undefined) {
  if (kind === "added") return addedMarker;
  if (kind === "modified") return modifiedMarker;
  if (kind === "deleted-before") return deletedMarker;
  return null;
}

const changeGutterTheme = EditorView.baseTheme({
  ".cm-s3-change-gutter": {
    width: "4px",
    minWidth: "4px"
  },
  ".cm-s3-change-gutter .cm-gutterElement": {
    padding: "0",
    width: "4px"
  },
  ".cm-s3-change-mark": {
    width: "3px",
    marginLeft: "1px",
    height: "100%",
    minHeight: "1.1em",
    borderRadius: "1px"
  },
  ".cm-s3-change-added": {
    backgroundColor: "hsl(142 70% 40%)"
  },
  ".cm-s3-change-modified": {
    backgroundColor: "hsl(217 90% 55%)"
  },
  ".cm-s3-change-deleted-before": {
    backgroundColor: "transparent",
    position: "relative",
    "&::before": {
      content: '""',
      position: "absolute",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      borderLeft: "3px solid hsl(215 14% 55%)",
      borderTop: "4px solid transparent",
      borderBottom: "4px solid transparent"
    }
  }
});

export function s3ChangeGutter(): Extension {
  return [
    baselineField,
    changeMarkersField,
    gutter({
      class: "cm-s3-change-gutter",
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        return markerForKind(view.state.field(changeMarkersField).get(lineNo));
      },
      initialSpacer: () => modifiedMarker
    }),
    changeGutterTheme
  ];
}
