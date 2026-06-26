import { Archive, ChevronLeft, ChevronRight, Cloud, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatSearchMatchLabel } from "@/services/logSearch";
import { LogDestinationPopover } from "@/components/logs/LogDestinationPopover";
import { LogSelectionBreadcrumb } from "@/components/logs/LogSelectionBreadcrumb";

export function LogCommandBar({
  activeSource,
  onSourceChange,
  sourceAvailability,
  breadcrumbSections,
  breadcrumbFullPath,
  destinationItems,
  searchInput,
  onSearchInputChange,
  regexSearch,
  onRegexSearchChange,
  onSubmitSearch,
  submittedSearch,
  activeMatchLabel,
  searchError,
  matchesCount,
  onPreviousMatch,
  onNextMatch,
  onDownload,
  onCopyPath,
  searchDisabled,
  hasSelection
}: {
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
  breadcrumbSections?: string[];
  breadcrumbFullPath?: string;
  destinationItems: Array<[string, string]>;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  regexSearch: boolean;
  onRegexSearchChange: (checked: boolean) => void;
  onSubmitSearch: () => void;
  submittedSearch: string;
  activeMatchLabel: string;
  searchError?: string;
  matchesCount: number;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  onDownload: () => void;
  onCopyPath: () => void;
  searchDisabled?: boolean;
  hasSelection: boolean;
}) {
  const copyPath = async () => {
    if (!breadcrumbFullPath) return;
    try {
      await navigator.clipboard?.writeText(breadcrumbFullPath);
      toast.success("Log path copied.");
    } catch {
      onCopyPath();
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Log viewer controls"
      className="sticky top-0 z-10 shrink-0 rounded-md border bg-card p-2"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tabs
            value={activeSource}
            onValueChange={(value) => onSourceChange(value as "s3" | "cloudwatch")}
          >
            <TabsList className="h-8">
              <TabsTrigger value="s3" disabled={!sourceAvailability.s3} className="h-7 px-2 text-xs">
                <Archive data-icon="inline-start" className="size-3.5" />
                S3
              </TabsTrigger>
              <TabsTrigger value="cloudwatch" disabled={!sourceAvailability.cloudwatch} className="h-7 px-2 text-xs">
                <Cloud data-icon="inline-start" className="size-3.5" />
                CloudWatch
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Separator orientation="vertical" className="hidden h-6 lg:block" />
          <div className="hidden min-w-0 md:block">
            <LogSelectionBreadcrumb sections={breadcrumbSections} fullPath={breadcrumbFullPath} />
          </div>
          <div className="min-w-0 md:hidden">
            <LogSelectionBreadcrumb sections={breadcrumbSections} fullPath={breadcrumbFullPath} compact />
          </div>
          <Separator orientation="vertical" className="hidden h-6 lg:block" />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Download selected log"
              disabled={!hasSelection}
              onClick={() => void onDownload()}
            >
              <Download className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Copy log path"
              disabled={!breadcrumbFullPath}
              onClick={() => void copyPath()}
            >
              <Copy className="size-4" />
            </Button>
            <LogDestinationPopover items={destinationItems} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end">
          <Input
            className="h-8 min-w-[12rem] flex-1"
            placeholder="Search in current log"
            aria-label="Search in current log"
            value={searchInput}
            disabled={searchDisabled}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitSearch();
              }
            }}
          />
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4"
              aria-label="Regex"
              checked={regexSearch}
              disabled={searchDisabled}
              onChange={(event) => onRegexSearchChange(event.target.checked)}
            />
            Regex
          </label>
          <Button type="button" size="sm" aria-label="Search log" disabled={searchDisabled} onClick={onSubmitSearch}>
            Search
          </Button>
          <span className={cn("min-w-16 shrink-0 text-xs", searchError ? "text-destructive" : "text-muted-foreground")}>
            {submittedSearch ? activeMatchLabel : "No results yet"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Previous match"
            disabled={matchesCount === 0}
            onClick={onPreviousMatch}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Next match"
            disabled={matchesCount === 0}
            onClick={onNextMatch}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
