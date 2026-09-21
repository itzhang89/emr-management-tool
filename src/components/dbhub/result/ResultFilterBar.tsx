import { useEffect, useRef, useState } from "react";
import { Code, Search } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CellFilter } from "@/services/dbWorkspaceCache";
import {
  completionAt,
  parseFilter,
  suggestionsFor,
  type FilterCompletion
} from "./resultFilterParse";

/**
 * The line above the data: the statement that produced it on the left, the box
 * that narrows it on the right.
 *
 * Both halves are DBeaver's, and they belong together for a reason that is not
 * about saving space: the rows below are the answer to *that* query, so the two
 * things a reader needs in order to trust what they are looking at — what was
 * asked, and what has since been hidden from the answer — are stated on one
 * line, above both formats. A grid that dropped rows while the SQL that
 * produced them was out of sight is the arrangement this replaces.
 *
 * The box is the only place conditions are written, which is what makes the
 * chips below it a *reading* of the expression rather than a second copy of it:
 * removing a chip rewrites this text, and the right-click menu appends to it.
 * One source, several views of it — so the two can never come to disagree about
 * what is being filtered.
 *
 * What is typed is not always what is applied. Text that does not parse is kept
 * — in the box, and in the tab's cache — while the conditions that *did* parse
 * stay in force, and the reason is spelled out under the box rather than
 * swallowed. The alternative is a grid that quietly goes on filtering by
 * something the user can no longer see.
 */

/** A suggestion list, and the word it would replace. */
interface Suggestion extends FilterCompletion {
  items: string[];
}

export function ResultFilterBar({
  sql,
  text = "",
  columns,
  runState,
  runError,
  onCommit
}: {
  sql: string;
  /** The filter text as the tab holds it — the box's value when nobody is typing. */
  text?: string;
  columns: string[];
  runState?: "cancelled" | "failed";
  runError?: string;
  /**
   * Absent when there is nothing to narrow — no rows are loaded — and then the
   * box is not drawn at all rather than offered and ignored.
   */
  onCommit?: (text: string, terms: CellFilter[] | null) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number | null>(null);

  const [draft, setDraft] = useState(text);
  /**
   * The text a commit refused, and why. Held against the draft rather than
   * cleared, so editing hides the message on its own and coming back to the
   * same words brings back the reason.
   */
  const [failed, setFailed] = useState<{ text: string; error: string } | null>(null);
  const [suggest, setSuggest] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(0);

  // The conditions can change from under the box — a chip taken off, a menu
  // item chosen, another row of the page followed — and the box is where they
  // are written, so it follows them.
  useEffect(() => setDraft(text), [text]);

  // An insertion moves the caret, and React owns the value: the position is
  // asked for in a ref and applied once the new text is on screen.
  useEffect(() => {
    const at = caretRef.current;
    if (at === null) return;
    caretRef.current = null;
    inputRef.current?.setSelectionRange(at, at);
  });

  const error = failed && failed.text === draft ? failed.error : null;

  const offer = (value: string, caret: number, force: boolean) => {
    const completion = completionAt(value, caret);
    const items = suggestionsFor(completion, columns);
    // Typing is what opens the list; Ctrl+Space asks for it. An empty prefix
    // offering the whole column list on every keystroke would be noise.
    if (items.length === 0 || (!force && completion.prefix.length === 0)) {
      setSuggest(null);
      return;
    }
    setSuggest({ ...completion, items });
    setActive(0);
  };

  const insert = (suggestion: string) => {
    if (!suggest) return;
    // A column is followed by the comparison that will be typed; a keyword that
    // is a whole phrase — IS NULL — is followed by whatever comes next.
    const suffix = suggest.expects === "column" ? "" : " ";
    caretRef.current = suggest.start + suggestion.length + suffix.length;
    setDraft(
      draft.slice(0, suggest.start) +
        suggestion +
        suffix +
        draft.slice(suggest.start + suggest.prefix.length)
    );
    setSuggest(null);
  };

  /**
   * Take the box as the new conditions — or keep the old ones and say why.
   *
   * Both outcomes store the text: a sentence that does not parse yet is still
   * what the user wrote, and losing it on the way out of the tab would be a
   * worse answer than keeping it and admitting it does not narrow anything.
   */
  const commit = () => {
    setSuggest(null);
    if (!onCommit || draft === text) {
      setFailed(null);
      return;
    }
    const parsed = parseFilter(draft, columns);
    if ("error" in parsed) {
      setFailed({ text: draft, error: parsed.error });
      onCommit(draft, null);
      return;
    }
    setFailed(null);
    onCommit(draft, parsed.terms);
  };

  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === " " && event.ctrlKey) {
      event.preventDefault();
      offer(draft, inputRef.current?.selectionStart ?? draft.length, true);
      return;
    }
    if (suggest) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((at) => Math.min(at + 1, suggest.items.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((at) => Math.max(at - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        setSuggest(null);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insert(suggest.items[active] ?? suggest.items[0]!);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") event.currentTarget.blur();
  };

  return (
    <div className="relative flex h-7 shrink-0 items-center gap-2 border-b bg-muted/20 px-2 text-[10px]">
      <Code className="size-3 shrink-0 text-muted-foreground/70" />
      {runState === "cancelled" ? (
        <span className="shrink-0 text-muted-foreground">{t("Cancelled")}</span>
      ) : null}
      {runState === "failed" ? (
        <span className="shrink-0 text-destructive">
          Failed{runError ? `: ${runError}` : ""}
        </span>
      ) : null}
      {/* The whole statement, cut off at the end: its beginning is what says
          which query this is. The rest is in the tooltip. */}
      <span
        title={sql}
        className={cn("min-w-0 truncate font-mono text-muted-foreground", !onCommit && "flex-1")}
        style={{ maxWidth: "45%" }}
      >
        {sql}
      </span>

      {onCommit ? (
        <>
          <span className="h-3 w-px shrink-0 bg-border" />
          <div className="relative flex min-w-0 flex-1 items-center gap-1">
            <Search className="size-3 shrink-0 text-muted-foreground/70" />
            <input
              ref={inputRef}
              value={draft}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("Filter results")}
              placeholder={t("Enter a SQL expression to filter results")}
              title={t("Conditions are joined with AND. Ctrl+Space lists the columns.")}
              className="h-5 min-w-0 flex-1 bg-transparent px-0.5 font-mono text-[11px] outline-none placeholder:font-sans placeholder:text-muted-foreground/60"
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value);
                offer(value, event.target.selectionStart ?? value.length, false);
              }}
              onKeyDown={keyDown}
              onBlur={commit}
            />

            {suggest ? (
              <div className="absolute top-full left-0 z-30 mt-0.5 max-h-56 w-full min-w-44 overflow-auto rounded-md border bg-popover p-1 font-mono text-[11px] shadow-md">
                {suggest.items.map((item, at) => (
                  <button
                    key={item}
                    type="button"
                    // Before the blur, or the click lands on an input that has
                    // already committed and closed the list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insert(item);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "block w-full truncate rounded-sm px-2 py-0.5 text-left",
                      at === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="absolute top-full left-0 z-30 mt-0.5 w-full rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive"
              >
                {error}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
