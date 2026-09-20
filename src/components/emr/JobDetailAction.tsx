import { Copy, Download, ZoomIn } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDescribeJobRun } from "@/hooks/useEmr";
import { localeTag, useLocale, useT, type EffectiveLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatAppError } from "@/services/appErrorMessage";
import { saveTextFile } from "@/services/fileDownload";
import type { JobRunDescribeDetails, JobRunSummary } from "@/types/domain";

const jobDetailPopoverDefaultWidth = 520;
const jobDetailPopoverMinWidth = 400;
const jobDetailPopoverMaxWidth = 900;

export function JobDetailAction({
  job,
  open,
  onOpenChange,
  buttonSize = "sm"
}: {
  job: JobRunSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonSize?: "sm" | "icon";
}) {
  const t = useT();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={buttonSize === "icon" ? "icon" : "sm"}
          className={buttonSize === "icon" ? "size-7" : undefined}
          aria-label={t("Job details")}
          onClick={() => onOpenChange(true)}
        >
          <ZoomIn className={buttonSize === "icon" ? "size-3.5" : undefined} data-icon={buttonSize === "sm" ? "inline-start" : undefined} />
          {buttonSize === "sm" ? t("Detail") : null}
        </Button>
      </PopoverTrigger>
      {open ? <JobDetailPopoverContent job={job} onClose={() => onOpenChange(false)} /> : null}
    </Popover>
  );
}

function JobDetailPopoverContent({ job, onClose }: { job: JobRunSummary; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [width, setWidth] = useState(jobDetailPopoverDefaultWidth);
  const describedJob = useDescribeJobRun(job.id, job.virtualClusterId);
  const detail = describedJob.data ?? job;
  const describeDetails = detail.describeDetails;

  const copyJobId = async () => {
    await navigator.clipboard?.writeText(job.id);
    toast.success(t("Job ID copied."));
    onClose();
  };

  const downloadDescription = async () => {
    try {
      const savedPath = await saveTextFile(`${detail.id}-description.json`, JSON.stringify(detail, null, 2));
      if (savedPath) {
        toast.success(t("Saved to {path}", { path: savedPath }));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const beginResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.min(
        jobDetailPopoverMaxWidth,
        Math.max(jobDetailPopoverMinWidth, startWidth + (startX - moveEvent.clientX))
      );
      setWidth(nextWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <PopoverContent
      side="left"
      align="center"
      sideOffset={8}
      collisionPadding={16}
      aria-label={t("Job run details")}
      style={{ width }}
      className="relative flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize job details panel")}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-border/80"
        onMouseDown={beginResize}
      />
      <div className="flex shrink-0 justify-end gap-1 border-b bg-popover px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("Download JSON")}
          onClick={() => void downloadDescription()}
        >
          <Download className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("Copy Job ID")} onClick={() => void copyJobId()}>
          <Copy className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {describedJob.isLoading ? <p className="text-sm text-muted-foreground">{t("Loading job details...")}</p> : null}
        {describedJob.error ? (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {errorMessage(describedJob.error)}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label={t("Started")} value={formatTimestamp(detail.startedAt, locale)} />
          <Detail label={t("Finished")} value={formatTimestamp(detail.finishedAt, locale)} />
          <Detail label={t("Release Label")} value={describeDetails?.releaseLabel} />
          <Detail
            label={t("Retry Attempts")}
            value={
              describeDetails?.retryMaxAttempts !== undefined || describeDetails?.retryCurrentAttemptCount !== undefined
                ? `${describeDetails?.retryCurrentAttemptCount ?? "-"} / ${describeDetails?.retryMaxAttempts ?? "-"}`
                : undefined
            }
          />
          <Detail label={t("State Details")} value={describeDetails?.stateDetails} span="full" />
          <Detail label={t("Failure Reason")} value={describeDetails?.failureReason} span="full" />
          {/* "ARN" is a protocol name and stays as-is in both locales. */}
          <Detail label="ARN" value={describeDetails?.arn} span="full" />
          <Detail label={t("Execution Role")} value={describeDetails?.executionRoleArn} span="full" />
          <Detail label={t("Created By")} value={describeDetails?.createdBy} />
          <Detail label={t("Client Token")} value={describeDetails?.clientToken} />
          <Detail label={t("Job Driver")} value={formatJobDriver(describeDetails)} span="full" multiline />
          <Detail label={t("Tags")} value={formatJson(describeDetails?.tags)} span="full" multiline />
          <Detail
            label={t("Configuration Overrides")}
            value={formatJson(describeDetails?.configurationOverrides)}
            span="full"
            multiline
          />
        </div>
      </div>
    </PopoverContent>
  );
}

function Detail({
  label,
  value,
  multiline = false,
  span = "half"
}: {
  label: string;
  value?: string;
  multiline?: boolean;
  span?: "half" | "full";
}) {
  if (!value) return null;

  return (
    <div className={span === "full" ? "col-span-2" : undefined}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(multiline ? "whitespace-pre-wrap break-all font-medium" : "break-all font-medium")}>{value}</p>
    </div>
  );
}

function formatTimestamp(value: string | undefined, locale: EffectiveLocale) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(localeTag(locale)) : value;
}

function formatJobDriver(details?: JobRunDescribeDetails) {
  const driver = details?.jobDriver;
  if (!driver) return undefined;

  if (driver.type === "sparkSubmit") {
    const lines = [
      driver.entryPoint ? `Entry Point: ${driver.entryPoint}` : undefined,
      driver.entryPointArguments?.length ? `Arguments: ${driver.entryPointArguments.join(" ")}` : undefined,
      driver.sparkSubmitParameters ? `Spark Submit: ${driver.sparkSubmitParameters}` : undefined
    ].filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  const lines = [
    driver.entryPoint ? `Entry Point: ${driver.entryPoint}` : undefined,
    driver.sparkSqlParameters ? `Spark SQL: ${driver.sparkSqlParameters}` : undefined
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatJson(value?: Record<string, unknown> | Record<string, string> | object) {
  if (!value || Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown) {
  return formatAppError(error, "Job operation failed.");
}
