import { cn } from "@/lib/utils";

export function KeyboardShortcutKey({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}
