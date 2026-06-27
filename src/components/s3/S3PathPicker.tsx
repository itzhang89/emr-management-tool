import { ArrowUp, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
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
import { useS3PathPicker } from "@/hooks/useS3PathPicker";
import { formatAppError } from "@/services/appErrorMessage";
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

  const dialog = (
    <S3PathPickerDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      initialPath={value}
      onSelect={(path) => {
        onChange(path);
        setDialogOpen(false);
      }}
    />
  );

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
        {dialog}
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
      {dialog}
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
  const picker = useS3PathPicker({ open, initialPath, appendSubmitUser });
  const effectivePath = resolveAthenaOutputLocation(picker.currentPath, submitUser ?? "user", picker.appendUser);

  const confirmSelection = () => {
    if (!picker.parsedPathInput?.bucket) {
      toast.error("Select an S3 bucket first.");
      return;
    }
    if (onAppendSubmitUserChange && picker.appendUser !== appendSubmitUser) {
      onAppendSubmitUserChange(picker.appendUser);
    }
    onSelect(picker.currentPath);
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
              value={picker.pathInput}
              onChange={(event) => picker.onPathInputChange(event.target.value)}
              onFocus={() => picker.setSuggestionsOpen(true)}
              onBlur={() => {
                window.setTimeout(() => picker.setSuggestionsOpen(false), 150);
              }}
              onKeyDown={picker.handlePathKeyDown}
              placeholder="bucket/folder/"
              className="min-w-0 flex-1 font-mono text-sm"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => picker.navigateTo(picker.pathInput, "commit")}
            >
              Go
            </Button>
            {picker.suggestionsOpen && picker.suggestions.length > 0 ? (
              <ul
                className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
                role="listbox"
              >
                {picker.suggestions.map((suggestion, index) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === picker.highlightIndex}
                      className={cn(
                        "block w-full px-3 py-2 text-left font-mono text-sm hover:bg-accent",
                        index === picker.highlightIndex && "bg-accent"
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        picker.selectOption(suggestion);
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
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={picker.browsePath}>
                {picker.browsePath}
              </p>
              <Button type="button" variant="ghost" size="sm" disabled={!picker.canGoUp} onClick={picker.goUp}>
                <ArrowUp data-icon="inline-start" />
                Up
              </Button>
            </div>
            <div className="max-h-64 overflow-auto p-2">
              {picker.isLoading ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">Loading...</p>
              ) : null}
              {picker.error ? (
                <p className="px-2 py-1 text-sm text-destructive">
                  {formatAppError(picker.error, "Failed to load S3 objects.")}
                </p>
              ) : null}
              {picker.options.map((item) => (
                <button
                  key={item.pathInput}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => picker.selectOption(item.pathInput)}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{item.label}</span>
                </button>
              ))}
              {picker.options.length === 0 && !picker.isLoading ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">
                  {picker.context.mode === "bucket" ? "No matching buckets." : "No matching folders under this prefix."}
                </p>
              ) : null}
            </div>
          </div>

          {onAppendSubmitUserChange ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={picker.appendUser}
                onCheckedChange={(checked) => picker.setAppendUser(checked === true)}
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
