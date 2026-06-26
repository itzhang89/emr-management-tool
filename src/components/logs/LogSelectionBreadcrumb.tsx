import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogSelectionBreadcrumb({
  sections,
  fullPath,
  compact = false
}: {
  sections?: string[];
  fullPath?: string;
  compact?: boolean;
}) {
  if (!sections?.length) {
    return <span className="truncate text-sm text-muted-foreground">Select a log file</span>;
  }

  const displaySections = compact ? [sections.at(-1)!] : sections;

  return (
    <nav aria-label="Current log file" className="min-w-0 max-w-xs lg:max-w-md">
      <span
        className={cn("flex min-w-0 items-center gap-0.5 truncate text-sm font-medium", compact && "text-xs")}
        title={fullPath}
      >
        {displaySections.map((section, index) => (
          <span key={`${section}-${index}`} className="flex min-w-0 items-center gap-0.5">
            {index > 0 ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{section}</span>
          </span>
        ))}
      </span>
    </nav>
  );
}
