import { useCallback, useEffect, useState } from "react";
import { useSubmissionHistory } from "@/hooks/useEmr";
import { useAutoRefreshCountdown } from "@/hooks/useJobHistoryAutoRefresh";
import { submissionHistorySettled } from "@/services/jobRunState";

/** Submit Job submission history + session-only auto-refresh (not persisted). */
export function useSubmitJobSubmissionHistory(virtualClusterId?: string) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const submissionJobs = useSubmissionHistory(virtualClusterId, autoRefresh, Boolean(virtualClusterId));
  const { refreshCountdown } = useAutoRefreshCountdown(autoRefresh, submissionJobs.dataUpdatedAt);

  useEffect(() => {
    if (!autoRefresh || !submissionJobs.data?.length) return;
    if (submissionHistorySettled(submissionJobs.data)) {
      setAutoRefresh(false);
    }
  }, [autoRefresh, submissionJobs.data]);

  const enableAfterSubmit = useCallback(() => setAutoRefresh(true), []);

  return {
    autoRefresh,
    setAutoRefresh,
    enableAfterSubmit,
    refreshCountdown,
    submissionJobs
  };
}
