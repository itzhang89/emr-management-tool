import { AlertCircle, FolderOpen, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { S3PathPickerDialog } from "@/components/s3/S3PathPicker";
import { useAthenaWorkgroups } from "@/hooks/useAthena";
import { cn } from "@/lib/utils";

export type AthenaQuerySettingsMode = "normal" | "setup" | "error";

export function AthenaQuerySettingsDialog({
  open,
  onOpenChange,
  mode = "normal",
  highlightSection,
  workgroup,
  onWorkgroupChange,
  outputBasePath,
  onOutputBasePathChange,
  appendSubmitUser,
  onAppendSubmitUserChange,
  submitUser,
  displayResultsPath,
  managedResultsEnabled,
  outputPathRequired,
  preferencesReady,
  errorMessage
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: AthenaQuerySettingsMode;
  highlightSection?: "s3" | "workgroup";
  workgroup: string;
  onWorkgroupChange: (value: string) => void;
  outputBasePath: string;
  onOutputBasePathChange: (value: string) => void;
  appendSubmitUser: boolean;
  onAppendSubmitUserChange: (value: boolean) => void;
  submitUser: string;
  displayResultsPath: string;
  managedResultsEnabled: boolean;
  outputPathRequired: boolean;
  preferencesReady: boolean;
  errorMessage?: string;
}) {
  const [s3DialogOpen, setS3DialogOpen] = useState(false);
  const workgroups = useAthenaWorkgroups();

  const workgroupOptions = useMemo(() => {
    const names = new Set((workgroups.data ?? []).map((entry) => entry.name));
    names.add(workgroup);
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [workgroup, workgroups.data]);

  const workgroupByName = useMemo(
    () => new Map((workgroups.data ?? []).map((entry) => [entry.name, entry])),
    [workgroups.data]
  );

  const title =
    mode === "setup" ? "Set up Athena query output" : mode === "error" ? "Fix query output settings" : "Query settings";

  const description =
    mode === "setup"
      ? "Choose a workgroup and an S3 folder for Athena query results before running SQL."
      : mode === "error"
        ? "Athena could not write query results with the current settings. Update the S3 output path or workgroup."
        : "Configure the Athena workgroup and S3 path used when running queries.";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <Settings2 className="size-4 shrink-0" />
              <span className="truncate">{title}</span>
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {mode === "setup" ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground break-words">
              Query results are written to S3. Pick a bucket prefix your AWS account can write to, for example{" "}
              <span className="break-all font-mono">s3://my-bucket/athena-results/</span>.
            </div>
          ) : null}

          {mode === "error" && errorMessage ? (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <p className="min-w-0 break-words">{errorMessage}</p>
            </div>
          ) : null}

          <div className="min-w-0 space-y-4 overflow-hidden">
            <div
              className={cn(
                "min-w-0 space-y-2 overflow-hidden rounded-md border p-3",
                highlightSection === "workgroup" && "border-primary/50 bg-primary/5"
              )}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Label htmlFor="athena-workgroup">Workgroup</Label>
                <Badge variant={managedResultsEnabled ? "secondary" : "outline"} className="shrink-0 font-normal">
                  {managedResultsEnabled ? "Managed results" : "S3 results"}
                </Badge>
              </div>
              <Select value={workgroup} onValueChange={onWorkgroupChange}>
                <SelectTrigger id="athena-workgroup" className="h-9 w-full max-w-full">
                  <SelectValue placeholder="Workgroup" />
                </SelectTrigger>
                <SelectContent>
                  {workgroups.isLoading ? <SelectItem value={workgroup}>{workgroup}</SelectItem> : null}
                  {workgroupOptions.map((name) => {
                    const entry = workgroupByName.get(name);
                    const suffix = entry?.managedResultsEnabled ? " · Managed" : entry?.sparkEnabled ? " · Spark" : "";
                    return (
                      <SelectItem key={name} value={name}>
                        {name}
                        {suffix}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {managedResultsEnabled ? (
                <p className="text-[11px] text-muted-foreground">
                  This workgroup uses Athena managed query results. An S3 path is optional.
                </p>
              ) : null}
            </div>

            <div
              className={cn(
                "min-w-0 space-y-2 rounded-md border p-3",
                highlightSection === "s3" && "border-primary/50 bg-primary/5",
                outputPathRequired && "border-destructive/40"
              )}
            >
              <Label htmlFor="athena-output-path">S3 query results path</Label>
              <div className="flex min-w-0 items-stretch gap-2">
                <p
                  id="athena-output-path"
                  className={cn(
                    "min-h-9 min-w-0 flex-1 break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs leading-snug",
                    outputPathRequired ? "border-destructive/50 text-destructive" : "text-muted-foreground"
                  )}
                >
                  {preferencesReady
                    ? displayResultsPath ||
                      (outputPathRequired ? "Not configured" : "s3://bucket/athena-results/")
                    : "Loading saved settings..."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-auto min-h-9 w-9 shrink-0 self-stretch"
                  aria-label="Browse S3 results path"
                  onClick={() => setS3DialogOpen(true)}
                >
                  <FolderOpen className="size-4 shrink-0" />
                </Button>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  id="append-submit-user"
                  checked={appendSubmitUser}
                  onCheckedChange={(checked) => onAppendSubmitUserChange(checked === true)}
                />
                <Label htmlFor="append-submit-user" className="min-w-0 text-xs font-normal break-words">
                  Append submit user folder ({submitUser || "user"})
                </Label>
              </div>
              {outputPathRequired ? (
                <p className="text-[11px] text-destructive">An S3 output path is required for the selected workgroup.</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <S3PathPickerDialog
        open={s3DialogOpen}
        onOpenChange={setS3DialogOpen}
        initialPath={outputBasePath}
        appendSubmitUser={appendSubmitUser}
        onAppendSubmitUserChange={onAppendSubmitUserChange}
        submitUser={submitUser}
        onSelect={(path) => {
          onOutputBasePathChange(path);
          setS3DialogOpen(false);
        }}
      />
    </>
  );
}

export function AthenaQuerySettingsButton({
  onClick,
  setupRequired
}: {
  onClick: () => void;
  setupRequired: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("relative size-8 shrink-0", setupRequired && "border-destructive/50")}
      aria-label="Query settings"
      title="Query settings"
      onClick={onClick}
    >
      <Settings2 className="size-4" />
      {setupRequired ? (
        <span className="absolute top-1 right-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
      ) : null}
    </Button>
  );
}
