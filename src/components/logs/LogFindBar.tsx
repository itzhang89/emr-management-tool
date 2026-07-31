import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function LogFindBar({
  open,
  searchInput,
  onSearchInputChange,
  regexSearch,
  onRegexSearchChange,
  onSubmitSearch,
  onClose,
  resultLabel,
  searchError,
  matchesCount,
  onPreviousMatch,
  onNextMatch,
  disabled,
  focusRequestId = 0
}: {
  open: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  regexSearch: boolean;
  onRegexSearchChange: (checked: boolean) => void;
  onSubmitSearch: () => void;
  onClose: () => void;
  resultLabel: string;
  searchError?: string;
  matchesCount: number;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  disabled?: boolean;
  /** Bumps when Cmd+F is pressed again while open so the input re-focuses. */
  focusRequestId?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open, focusRequestId]);

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Find in log"
      data-testid="log-find-bar"
      className="absolute left-3 top-2 z-20 flex max-w-[calc(100%-6rem)] items-center gap-1.5 rounded-md border border-slate-600 bg-slate-900/95 px-2 py-1 shadow-lg backdrop-blur"
    >
      <Search className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      <Input
        ref={inputRef}
        className="h-7 min-w-[10rem] flex-1 border-0 bg-transparent px-1 text-xs text-slate-100 shadow-none focus-visible:ring-0"
        placeholder="Find"
        aria-label="Find in current log"
        value={searchInput}
        disabled={disabled}
        onChange={(event) => onSearchInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
              onPreviousMatch();
              return;
            }
            onSubmitSearch();
          }
        }}
      />
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
        <input
          type="checkbox"
          className="size-3.5"
          aria-label="Regex"
          checked={regexSearch}
          disabled={disabled}
          onChange={(event) => onRegexSearchChange(event.target.checked)}
        />
        Regex
      </label>
      <span
        className={cn(
          "min-w-14 shrink-0 text-center text-[11px] tabular-nums",
          searchError ? "text-red-400" : "text-slate-400"
        )}
      >
        {searchError ?? resultLabel}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-slate-300 hover:bg-slate-800 hover:text-slate-50"
        aria-label="Previous match"
        disabled={matchesCount === 0}
        onClick={onPreviousMatch}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-slate-300 hover:bg-slate-800 hover:text-slate-50"
        aria-label="Next match"
        disabled={matchesCount === 0}
        onClick={onNextMatch}
      >
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  );
}
