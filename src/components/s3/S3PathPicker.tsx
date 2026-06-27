import { ArrowUp, Folder, FolderOpen } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useS3Buckets, useS3Objects } from "@/hooks/useS3";
import { formatAppError } from "@/services/appErrorMessage";
import {
  displayObjectName,
  formatPathInput,
  formatS3Path,
  parentPrefix,
  parseS3PathInput
} from "@/services/s3PathUtils";
import { cn } from "@/lib/utils";
import { resolveAthenaOutputLocation } from "@/services/athenaOutputPath";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

export function S3PathPicker({
  id,
  label,
  value,
  onChange,
  placeholder = "s3://bucket/prefix/",
  compact = false
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (compact) {
    return (
      <>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-[180px] flex-1 font-mono text-sm"
          title={value}
        />
        <Button type="button" variant="outline" size="icon" onClick={() => setDialogOpen(true)} aria-label="Browse S3">
          <FolderOpen className="size-4" />
        </Button>
        <S3PathPickerDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialPath={value}
          onSelect={(path) => {
            onChange(path);
            setDialogOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm"
        />
        <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
          <FolderOpen data-icon="inline-start" />
          Browse
        </Button>
      </div>
      <S3PathPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialPath={value}
        onSelect={(path) => {
          onChange(path);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

export function S3PathPickerDialog({
  open,
  onOpenChange,
  initialPath,
  onSelect,
  appendSubmitUser,
  onAppendSubmitUserChange,
  submitUser
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath: string;
  onSelect: (path: string) => void;
  appendSubmitUser?: boolean;
  onAppendSubmitUserChange?: (value: boolean) => void;
  submitUser?: string;
}) {
  const buckets = useS3Buckets();
  const parsedInitial = useMemo(() => parseS3PathInput(initialPath), [initialPath]);
  const [bucket, setBucket] = useState<string>();
  const [prefix, setPrefix] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [appendUser, setAppendUser] = useState(appendSubmitUser ?? false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const parsed = parseS3PathInput(initialPath);
    const fallbackBucket = parsed?.bucket ?? buckets.data?.[0]?.name;
    setBucket(fallbackBucket);
    setPrefix(parsed?.prefix ?? "");
    setPathInput(formatPathInput(fallbackBucket, parsed?.prefix ?? ""));
    setAppendUser(appendSubmitUser ?? false);
    setHighlightIndex(-1);
    setSuggestionsOpen(false);
  }, [open, initialPath, buckets.data, appendSubmitUser]);

  const selectedBucket = bucket ?? parsedInitial?.bucket ?? buckets.data?.[0]?.name;
  const objects = useS3Objects(open ? selectedBucket : undefined, prefix);
  const currentPath = formatS3Path(selectedBucket, prefix);
  const effectivePath = resolveAthenaOutputLocation(currentPath, submitUser ?? "user", appendUser);

  const suggestions = useMemo(() => {
    const needle = pathInput.trim().toLowerCase();
    const bucketOptions = (buckets.data ?? []).map((entry) => `${entry.name}/`);
    if (!needle) return bucketOptions.slice(0, 12);
    return bucketOptions.filter((option) => option.toLowerCase().includes(needle)).slice(0, 12);
  }, [buckets.data, pathInput]);

  const applyParsedPath = (raw: string) => {
    const parsed = parseS3PathInput(raw);
    if (!parsed) {
      toast.error("Enter a valid S3 path like bucket/folder/");
      return false;
    }
    setBucket(parsed.bucket);
    setPrefix(parsed.prefix);
    setPathInput(formatPathInput(parsed.bucket, parsed.prefix));
    setSuggestionsOpen(false);
    setHighlightIndex(-1);
    return true;
  };

  const selectSuggestion = (suggestion: string) => {
    setPathInput(suggestion);
    applyParsedPath(suggestion);
  };

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
      event.preventDefault();
      setSuggestionsOpen(true);
      setHighlightIndex(event.key === "ArrowDown" ? 0 : suggestions.length - 1);
      return;
    }

    if (!suggestionsOpen || suggestions.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyParsedPath(event.currentTarget.value);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectSuggestion(suggestions[highlightIndex]);
        return;
      }
      applyParsedPath(event.currentTarget.value);
      return;
    }

    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setHighlightIndex(-1);
    }
  };

  const confirmSelection = () => {
    if (!selectedBucket) {
      toast.error("Select an S3 bucket first.");
      return;
    }
    if (onAppendSubmitUserChange && appendUser !== appendSubmitUser) {
      onAppendSubmitUserChange(appendUser);
    }
    onSelect(currentPath);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select S3 path</DialogTitle>
          <DialogDescription>Browse buckets and folders, or type a path directly.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3 overflow-hidden">
          <div className="relative flex min-w-0 gap-2 overflow-hidden">
            <Input
              ref={inputRef}
              value={pathInput}
              onChange={(event) => {
                setPathInput(event.target.value);
                setSuggestionsOpen(true);
                setHighlightIndex(-1);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setSuggestionsOpen(false), 150);
              }}
              onKeyDown={handlePathKeyDown}
              placeholder="bucket/folder/"
              className="min-w-0 flex-1 font-mono text-sm"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => applyParsedPath(pathInput)}
            >
              Go
            </Button>
            {suggestionsOpen && suggestions.length > 0 ? (
              <ul
                className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
                role="listbox"
              >
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlightIndex}
                      className={cn(
                        "block w-full px-3 py-2 text-left font-mono text-sm hover:bg-accent",
                        index === highlightIndex && "bg-accent"
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectSuggestion(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-md border">
            <div className="flex min-w-0 items-center justify-between gap-2 border-b px-3 py-2">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={currentPath || "s3://"}>
                {currentPath || "s3://"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!prefix}
                onClick={() => {
                  const parent = parentPrefix(prefix);
                  setPrefix(parent);
                  setPathInput(formatPathInput(selectedBucket, parent));
                }}
              >
                <ArrowUp data-icon="inline-start" />
                Up
              </Button>
            </div>
            <div className="max-h-64 overflow-auto p-2">
              {buckets.isLoading || objects.isLoading ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">Loading...</p>
              ) : null}
              {buckets.error || objects.error ? (
                <p className="px-2 py-1 text-sm text-destructive">
                  {formatAppError(buckets.error ?? objects.error, "Failed to load S3 objects.")}
                </p>
              ) : null}
              {(objects.data ?? []).map((object) => (
                <button
                  key={object.key}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    if (object.kind === "folder") {
                      setPrefix(object.key);
                      setPathInput(formatPathInput(selectedBucket, object.key));
                      return;
                    }
                    const folderPrefix = object.key.includes("/")
                      ? object.key.slice(0, object.key.lastIndexOf("/") + 1)
                      : "";
                    setPrefix(folderPrefix);
                    setPathInput(formatPathInput(selectedBucket, folderPrefix));
                  }}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">
                    {displayObjectName(object.key, prefix, object.kind)}
                  </span>
                </button>
              ))}
              {(objects.data?.length ?? 0) === 0 && !objects.isLoading ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">No folders under this prefix.</p>
              ) : null}
            </div>
          </div>

          {onAppendSubmitUserChange ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={appendUser}
                onCheckedChange={(checked) => setAppendUser(checked === true)}
              />
              <span>
                Append submitUser subdirectory
                <span className="font-mono text-muted-foreground"> ({submitUser ?? "user"})</span>
              </span>
            </label>
          ) : null}

          {onAppendSubmitUserChange ? (
            <p className="overflow-hidden text-xs text-muted-foreground">
              Athena results path:{" "}
              <span className="block truncate font-mono text-foreground" title={effectivePath || undefined}>
                {effectivePath || "—"}
              </span>
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={confirmSelection}>
            Use path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
