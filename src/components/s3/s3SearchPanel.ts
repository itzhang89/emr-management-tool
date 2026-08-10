import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  closeSearchPanel
} from "@codemirror/search";
import { formatModShortcut } from "@/lib/keyboardShortcut";
import {
  addExcludedRange,
  buildReplaceAllChanges,
  collectSearchMatches,
  findActiveMatchIndex,
  formatS3SearchMatchLabel,
  isRangeExcluded,
  s3ReplaceModeField,
  setS3ReplaceMode,
  type SearchMatchRange
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

function iconToggle(
  label: string,
  title: string,
  pressed: boolean,
  onToggle: () => void
): HTMLButtonElement {
  return elt(
    "button",
    {
      type: "button",
      class: "cm-s3-opt-btn",
      title,
      "aria-label": title,
      "aria-pressed": pressed ? "true" : "false",
      onclick: (event) => {
        event.preventDefault();
        onToggle();
      }
    },
    [label]
  ) as HTMLButtonElement;
}

export function createS3SearchPanel(view: EditorView): Panel {
  return new S3SearchPanel(view);
}

class S3SearchPanel implements Panel {
  dom: HTMLElement;
  private view: EditorView;
  private query: SearchQuery;
  private excluded: SearchMatchRange[] = [];
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private caseButton: HTMLButtonElement;
  private wordButton: HTMLButtonElement;
  private regexpButton: HTMLButtonElement;
  private countLabel: HTMLElement;
  private replaceRow: HTMLElement;
  private excludeButton: HTMLButtonElement;
  private caseSensitive: boolean;
  private wholeWord: boolean;
  private regexp: boolean;

  constructor(view: EditorView) {
    this.view = view;
    const query = (this.query = getSearchQuery(view.state));
    this.caseSensitive = query.caseSensitive;
    this.wholeWord = query.wholeWord;
    this.regexp = query.regexp;

    this.searchField = elt("input", {
      value: query.search,
      placeholder: "Find",
      "aria-label": "Find",
      class: "cm-s3-field-input",
      name: "search",
      form: "",
      "main-field": "true",
      oninput: () => this.commit(),
      onchange: () => this.commit()
    }) as HTMLInputElement;

    this.replaceField = elt("input", {
      value: query.replace,
      placeholder: "Replace",
      "aria-label": "Replace",
      class: "cm-s3-field-input",
      name: "replace",
      form: "",
      oninput: () => this.commit(),
      onchange: () => this.commit()
    }) as HTMLInputElement;

    this.caseButton = iconToggle("Cc", "Match case", this.caseSensitive, () => {
      this.caseSensitive = !this.caseSensitive;
      this.syncOptionButtons();
      this.commit();
    });
    this.wordButton = iconToggle("W", "By word", this.wholeWord, () => {
      this.wholeWord = !this.wholeWord;
      this.syncOptionButtons();
      this.commit();
    });
    this.regexpButton = iconToggle(".*", "Regexp", this.regexp, () => {
      this.regexp = !this.regexp;
      this.syncOptionButtons();
      this.commit();
    });

    this.countLabel = elt("span", {
      class: "cm-s3-search-count",
      "aria-live": "polite"
    });

    const prevTitle = `Previous match (${formatModShortcut("G", { shift: true })})`;
    const nextTitle = `Next match (${formatModShortcut("G")})`;

    const findShell = elt("div", { class: "cm-s3-field-shell" }, [
      this.searchField,
      elt("div", { class: "cm-s3-field-trailing" }, [
        this.caseButton,
        this.wordButton,
        this.regexpButton,
        this.countLabel,
        elt(
          "button",
          {
            type: "button",
            class: "cm-s3-nav-btn",
            name: "prev",
            title: prevTitle,
            "aria-label": prevTitle,
            onclick: () => findPrevious(view)
          },
          ["⬆"]
        ),
        elt(
          "button",
          {
            type: "button",
            class: "cm-s3-nav-btn",
            name: "next",
            title: nextTitle,
            "aria-label": nextTitle,
            onclick: () => findNext(view)
          },
          ["⬇"]
        )
      ])
    ]);

    const actionButton = (name: string, label: string, onclick: () => void) =>
      elt("button", { class: "cm-button", name, type: "button", onclick }, [label]);

    this.excludeButton = actionButton("exclude", "Exclude", () => this.excludeCurrent()) as HTMLButtonElement;

    this.replaceRow = elt("div", { class: "cm-s3-search-row cm-s3-search-replace" }, [
      elt("div", { class: "cm-s3-field-shell cm-s3-replace-shell" }, [this.replaceField]),
      actionButton("replace", "Replace", () => replaceNext(view)),
      actionButton("replaceAll", "Replace all", () => this.replaceAllWithExclusions()),
      this.excludeButton
    ]);

    this.dom = elt("div", { class: "cm-search cm-s3-search", onkeydown: (event) => this.keydown(event) }, [
      elt("div", { class: "cm-s3-search-row" }, [findShell]),
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

    this.syncOptionButtons();
    this.syncReplaceVisibility();
    this.refreshCount();
  }

  private syncOptionButtons() {
    this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
    this.wordButton.setAttribute("aria-pressed", String(this.wholeWord));
    this.regexpButton.setAttribute("aria-pressed", String(this.regexp));
    this.caseButton.classList.toggle("is-active", this.caseSensitive);
    this.wordButton.classList.toggle("is-active", this.wholeWord);
    this.regexpButton.classList.toggle("is-active", this.regexp);
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseSensitive,
      regexp: this.regexp,
      wholeWord: this.wholeWord,
      replace: this.replaceField.value
    });
    const queryChanged = !query.eq(this.query);
    if (queryChanged) {
      if (
        query.search !== this.query.search ||
        query.caseSensitive !== this.query.caseSensitive ||
        query.regexp !== this.query.regexp ||
        query.wholeWord !== this.query.wholeWord
      ) {
        this.excluded = [];
      }
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    this.refreshCount();
  }

  private activeMatch(): SearchMatchRange | null {
    const { matches } = collectSearchMatches(this.view.state, this.query);
    if (matches.length === 0) return null;
    const { from, to } = this.view.state.selection.main;
    const index = findActiveMatchIndex(matches, from, to);
    if (index < 0) return null;
    return matches[index] ?? null;
  }

  private excludeCurrent() {
    if (this.view.state.readOnly) return;
    const match = this.activeMatch();
    if (!match) return;
    this.excluded = addExcludedRange(this.excluded, match);
    findNext(this.view);
    this.refreshCount();
  }

  private replaceAllWithExclusions() {
    if (this.view.state.readOnly) return;
    const changes = buildReplaceAllChanges(this.view.state, this.query, this.excluded);
    if (changes.length === 0) return;
    this.view.dispatch({
      changes,
      userEvent: "input.replace.all"
    });
    this.excluded = [];
    this.refreshCount();
  }

  private refreshCount() {
    const query = this.query;
    if (query.regexp && !query.valid) {
      this.countLabel.textContent = formatS3SearchMatchLabel(0, 0, { error: "Invalid regex" });
      this.excludeButton.disabled = true;
      return;
    }

    if (!query.search.trim()) {
      this.countLabel.textContent = formatS3SearchMatchLabel(0, 0);
      this.excludeButton.disabled = true;
      return;
    }

    const { matches, truncated } = collectSearchMatches(this.view.state, query);
    const { from, to } = this.view.state.selection.main;
    const activeIndex = findActiveMatchIndex(matches, from, to);
    this.countLabel.textContent = formatS3SearchMatchLabel(matches.length, activeIndex, {
      truncated
    });

    const active = activeIndex >= 0 ? matches[activeIndex] : null;
    this.excludeButton.disabled =
      this.view.state.readOnly || !active || isRangeExcluded(this.excluded, active);
  }

  private syncReplaceVisibility() {
    const replaceMode = this.view.state.field(s3ReplaceModeField, false) ?? false;
    const show = replaceMode && !this.view.state.readOnly;
    this.replaceRow.style.display = show ? "" : "none";
    this.dom.classList.toggle("cm-s3-search-replace-open", show);
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
        if (effect.is(setS3ReplaceMode)) {
          this.syncReplaceVisibility();
          if (effect.value) {
            queueMicrotask(() => {
              this.replaceField.focus();
              this.replaceField.select();
            });
          }
        }
      }
    }
    if (update.docChanged) {
      this.excluded = [];
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))
    ) {
      this.refreshCount();
    }
    if (
      update.startState.readOnly !== update.state.readOnly ||
      update.startState.field(s3ReplaceModeField, false) !== update.state.field(s3ReplaceModeField, false)
    ) {
      this.syncReplaceVisibility();
    }
  }

  private setQuery(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseSensitive = query.caseSensitive;
    this.regexp = query.regexp;
    this.wholeWord = query.wholeWord;
    this.syncOptionButtons();
  }

  mount() {
    const replaceMode = this.view.state.field(s3ReplaceModeField, false) ?? false;
    if (replaceMode && !this.view.state.readOnly) {
      this.replaceField.focus();
      this.replaceField.select();
      return;
    }
    this.searchField.select();
  }

  get pos() {
    return 80;
  }

  get top() {
    return true;
  }
}
