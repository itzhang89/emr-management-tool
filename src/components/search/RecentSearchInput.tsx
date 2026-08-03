import { Search } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type RecentSearchInputHandle = {
  focus: () => void;
};

export const RecentSearchInput = forwardRef<
  RecentSearchInputHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (query: string) => void;
    recentSearches: string[];
    placeholder?: string;
    title?: string;
    className?: string;
    inputClassName?: string;
    listLabel?: string;
  }
>(function RecentSearchInput(
  {
    value,
    onChange,
    onSubmit,
    recentSearches,
    placeholder,
    title,
    className,
    inputClassName,
    listLabel = "Recent searches"
  },
  ref
) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showRecentSearches = historyOpen && recentSearches.length > 0;

  const openRecentSearches = () => {
    if (recentSearches.length === 0) return;
    setHistoryOpen(true);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
      openRecentSearches();
    }
  }));

  useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [historyOpen]);

  const submit = (query: string) => {
    onSubmit(query);
    setHistoryOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative w-[16rem] min-w-[16rem]", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className={cn("h-9 pl-9", inputClassName)}
        placeholder={placeholder}
        title={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={openRecentSearches}
        onClick={openRecentSearches}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit(value);
          }
          if (event.key === "Escape") {
            setHistoryOpen(false);
          }
        }}
      />
      {showRecentSearches ? (
        <ul
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          role="listbox"
          aria-label={listLabel}
        >
          {recentSearches.map((query) => (
            <li key={query} role="option">
              <button
                type="button"
                className="flex w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(query);
                  submit(query);
                }}
              >
                {query}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
