import { FolderOpen, Layers3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { S3PathPickerDialog } from "@/components/s3/S3PathPicker";
import { useAthenaWorkgroups } from "@/hooks/useAthena";

export function AthenaQueryOptionsBar({
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
  preferencesReady
}: {
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
}) {
  const [s3DialogOpen, setS3DialogOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1.5">
      <WorkgroupButton value={workgroup} onChange={onWorkgroupChange} />

      <Badge
        variant={managedResultsEnabled ? "secondary" : "outline"}
        className="shrink-0 font-normal"
        title={
          managedResultsEnabled
            ? "This workgroup stores query results in Athena managed storage"
            : "Query results are written to your S3 path"
        }
      >
        {managedResultsEnabled ? "Managed" : "S3"}
      </Badge>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p
          id="athena-output-path"
          className="h-8 min-w-0 flex-1 truncate rounded-md border border-input bg-muted/40 px-2 font-mono text-xs leading-8 text-muted-foreground"
          title={
            preferencesReady
              ? managedResultsEnabled
                ? "S3 path is optional here; this workgroup uses Athena managed results"
                : displayResultsPath
              : "Loading saved S3 path..."
          }
        >
          {preferencesReady
            ? displayResultsPath ||
              (outputPathRequired ? "Set S3 results path (Browse)" : "s3://bucket/athena-results/")
            : "Loading saved S3 path..."}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Browse S3 results path"
              onClick={() => setS3DialogOpen(true)}
            >
              <FolderOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Browse Athena results S3 path</TooltipContent>
        </Tooltip>
      </div>

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
    </div>
  );
}

function WorkgroupButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const workgroups = useAthenaWorkgroups();
  const options = useMemo(() => {
    const names = new Set((workgroups.data ?? []).map((entry) => entry.name));
    names.add(value);
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [value, workgroups.data]);

  const workgroupByName = useMemo(
    () => new Map((workgroups.data ?? []).map((entry) => [entry.name, entry])),
    [workgroups.data]
  );

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label="Athena workgroup">
              <Layers3 className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Athena workgroup
          <span className="font-mono"> · {value}</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="mb-2 text-xs text-muted-foreground">Athena workgroup for query execution</p>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="athena-workgroup" className="h-8">
            <SelectValue placeholder="Workgroup" />
          </SelectTrigger>
          <SelectContent>
            {workgroups.isLoading ? <SelectItem value={value}>{value}</SelectItem> : null}
            {options.map((name) => {
              const entry = workgroupByName.get(name);
              const suffix = entry?.managedResultsEnabled ? " · Managed" : entry?.sparkEnabled ? " · Spark" : "";
              return (
                <SelectItem key={name} value={name}>
                  {name}{suffix}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </PopoverContent>
    </Popover>
  );
}
