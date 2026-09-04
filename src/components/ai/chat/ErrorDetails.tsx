import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CopyJsonButton } from "@/components/ui/CopyJsonButton";
import { formatJson } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatErrorDetails } from "@/types/domain";

/** Client-side cap on bodies, in case a row predates the backend's truncation. */
const BODY_CAP = 8_000;

function cap(text: string): string {
  return text.length > BODY_CAP ? `${text.slice(0, BODY_CAP)}…` : text;
}

/** One key/value row in the diagnostics panel. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="break-all font-mono text-xs leading-relaxed">{value}</p>
    </div>
  );
}

/** A body block with a copy affordance. */
function Block({ label, value, json }: { label: string; value: string; json?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex h-6 items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <CopyJsonButton value={value} label={label} />
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs leading-relaxed",
          json && "text-[11px]"
        )}
      >
        {value}
      </pre>
    </div>
  );
}

/**
 * The expandable "details" behind a short error line on an errored reply: what
 * was requested, what the provider said back, and the error chain. Hidden when
 * the message carries no diagnostics, so old rows and non-request failures show
 * nothing extra.
 */
export function ErrorDetails({ details }: { details?: ChatErrorDetails | null }) {
  const [open, setOpen] = useState(false);

  const hasDetails = Boolean(
    details &&
      (details.url ||
        details.method ||
        details.httpStatus != null ||
        details.providerReason ||
        details.errorCode ||
        details.errorKind ||
        details.stack ||
        details.requestBody != null ||
        details.responseBody != null)
  );
  if (!details || !hasDetails) return null;

  const requestLine = [details.method, details.url].filter(Boolean).join(" ");

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border p-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            open && "rotate-90"
          )}
        />
        Details
      </button>

      {open && (
        <div className="space-y-2 px-0.5 pb-0.5">
          {requestLine && <Field label="Request" value={requestLine} />}
          {details.httpStatus != null && (
            <Field label="HTTP status" value={String(details.httpStatus)} />
          )}
          {details.providerReason && <Field label="Provider reason" value={details.providerReason} />}
          {details.errorCode && <Field label="Error code" value={details.errorCode} />}
          {details.errorKind && <Field label="Error kind" value={details.errorKind} />}
          {details.requestBody != null && (
            <Block label="Request body" value={formatJson(details.requestBody)} json />
          )}
          {details.responseBody != null && (
            <Block label="Response body" value={cap(details.responseBody)} />
          )}
          {details.stack && <Block label="Error chain" value={cap(details.stack)} />}
        </div>
      )}
    </div>
  );
}
