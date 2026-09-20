import { useT } from "@/i18n";

export function LogsEmptyState({
  recentJobIds = [],
  onSelectJobId
}: {
  recentJobIds?: string[];
  onSelectJobId?: (jobId: string) => void;
}) {
  const t = useT();

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {t("Select a job from Job History or enter a job id to view logs.")}
      </p>
      {recentJobIds.length > 0 && onSelectJobId ? (
        <div className="rounded-md border p-3">
          <h2 className="mb-2 text-sm font-medium text-foreground">{t("Recently viewed")}</h2>
          <ul className="flex flex-col gap-0.5" aria-label={t("Recently viewed job ids")}>
            {recentJobIds.map((jobId) => (
              <li key={jobId}>
                <button
                  type="button"
                  className="flex w-full truncate rounded-sm px-2 py-1.5 text-left font-mono text-sm hover:bg-accent"
                  onClick={() => onSelectJobId(jobId)}
                >
                  {jobId}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
