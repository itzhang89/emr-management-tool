import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel
} from "@codemirror/search";
import {
  collectSearchMatches,
  findActiveMatchIndex,
  formatS3SearchMatchLabel
} from "@/services/s3EditorSearch";

function elt(
  tag: string,
  attrs: Record<string, string | boolean | ((event: Event) => void) | null | undefined> | null,
  ...children: Array<Node | string | Array<Node | string>>
) {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null) continue;
      if (typeof value === "function") {
        element.addEventListener(name.replace(/^on/, "").toLowerCase(), value as EventListener);
      } else if (name === "checked" && element instanceof HTMLInputElement) {
        element.checked = Boolean(value);
      } else if (value === true) {
        element.setAttribute(name, "");
      } else if (value !== false) {
        element.setAttribute(name, String(value));
      }
    }
  }
  for (const child of children.flat()) {
    element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

export function createS3SearchPanel(view: EditorView): Panel {
  return new S3SearchPanel(view);
}

class S3SearchPanel implements Panel {
  dom: HTMLElement;
  private view: EditorView;
  private query: SearchQuery;
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private caseField: HTMLInputElement;
  private reField: HTMLInputElement;
  private wordField: HTMLInputElement;
  private countLabel: HTMLElement;
  private replaceRow: HTMLElement;

  constructor(view: EditorView) {
    this.view = view;
    const query = (this.query = getSearchQuery(view.state));

    this.searchField = elt("input", {
      value: query.search,
      placeholder: "Find",
      "aria-label": "Find",
      class: "cm-textfield cm-s3-search-input",
      name: "search",
      form: "",
      "main-field": "true",
      onchange: () => this.commit(),
      onkeyup: () => this.commit()
    }) as HTMLInputElement;

    this.replaceField = elt("input", {
      value: query.replace,
      placeholder: "Replace",
      "aria-label": "Replace",
      class: "cm-textfield cm-s3-search-input",
      name: "replace",
      form: "",
      onchange: () => this.commit(),
      onkeyup: () => this.commit()
    }) as HTMLInputElement;

    this.caseField = elt("input", {
      type: "checkbox",
      name: "case",
      form: "",
      checked: query.caseSensitive,
      onchange: () => this.commit()
    }) as HTMLInputElement;

    this.reField = elt("input", {
      type: "checkbox",
      name: "re",
      form: "",
      checked: query.regexp,
      onchange: () => this.commit()
    }) as HTMLInputElement;

    this.wordField = elt("input", {
      type: "checkbox",
      name: "word",
      form: "",
      checked: query.wholeWord,
      onchange: () => this.commit()
    }) as HTMLInputElement;

    this.countLabel = elt("span", {
      class: "cm-s3-search-count",
      "aria-live": "polite"
    });

    const button = (name: string, label: string, onclick: () => void) =>
      elt("button", { class: "cm-button", name, type: "button", onclick }, [label]);

    const findRow = elt("div", { class: "cm-s3-search-row" }, [
      this.searchField,
      this.countLabel,
      button("prev", "Prev", () => findPrevious(view)),
      button("next", "Next", () => findNext(view))
    ]);

    const optionsRow = elt("div", { class: "cm-s3-search-row cm-s3-search-options" }, [
      elt("label", null, [this.caseField, "Match case"]),
      elt("label", null, [this.reField, "Regexp"]),
      elt("label", null, [this.wordField, "By word"])
    ]);

    this.replaceRow = elt("div", { class: "cm-s3-search-row cm-s3-search-replace" }, [
      this.replaceField,
      button("replace", "Replace", () => replaceNext(view)),
      button("replaceAll", "Replace all", () => replaceAll(view))
    ]);

    this.dom = elt("div", { class: "cm-search cm-s3-search", onkeydown: (event) => this.keydown(event) }, [
      findRow,
      optionsRow,
      this.replaceRow,
      elt(
        "button",
        {
          name: "close",
          type: "button",
          "aria-label": "Close",
          onclick: () => closeSearchPanel(view)
        },
        ["×"]
      )
    ]);

    this.syncReplaceVisibility();
    this.refreshCount();
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    this.refreshCount();
  }

  private refreshCount() {
    const query = this.query;
    if (!query.search.trim()) {
      this.countLabel.textContent = formatS3SearchMatchLabel(0, 0, { emptyQuery: true });
      return;
    }
    if (query.regexp && !query.valid) {
      this.countLabel.textContent = formatS3SearchMatchLabel(0, 0, { error: "Invalid regex" });
      return;
    }

    const { matches, truncated } = collectSearchMatches(this.view.state, query);
    const { from, to } = this.view.state.selection.main;
    const activeIndex = findActiveMatchIndex(matches, from, to);
    this.countLabel.textContent = formatS3SearchMatchLabel(matches.length, activeIndex, {
      truncated
    });
  }

  private syncReplaceVisibility() {
    this.replaceRow.style.display = this.view.state.readOnly ? "none" : "";
  }

  private keydown(event: Event) {
    const keyboardEvent = event as KeyboardEvent;
    if (runScopeHandlers(this.view, keyboardEvent, "search-panel")) {
      keyboardEvent.preventDefault();
      return;
    }
    if (keyboardEvent.key === "Enter" && keyboardEvent.target === this.searchField) {
      keyboardEvent.preventDefault();
      (keyboardEvent.shiftKey ? findPrevious : findNext)(this.view);
      return;
    }
    if (keyboardEvent.key === "Enter" && keyboardEvent.target === this.replaceField) {
      keyboardEvent.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))
    ) {
      this.refreshCount();
    }
    if (update.startState.readOnly !== update.state.readOnly) {
      this.syncReplaceVisibility();
    }
  }

  private setQuery(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.reField.checked = query.regexp;
    this.wordField.checked = query.wholeWord;
  }

  mount() {
    this.searchField.select();
  }

  get pos() {
    return 80;
  }

  get top() {
    return true;
  }
}
