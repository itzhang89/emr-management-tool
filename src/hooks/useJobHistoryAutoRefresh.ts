import { useEffect, useState } from "react";
import {
  JOB_HISTORY_REFRESH_INTERVAL_SECONDS,
  JOB_HISTORY_REFRESH_INTERVAL_MS
} from "@/services/jobHistoryConstants";
import {
  readJobHistoryAutoRefreshPreference,
  writeJobHistoryAutoRefreshPreference
} from "@/services/jobHistoryPreferences";

export function useAutoRefreshCountdown(autoRefresh: boolean, dataUpdatedAt?: number) {
  const [refreshCountdown, setRefreshCountdown] = useState(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);

  useEffect(() => {
    if (!autoRefresh) {
      setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
      return;
    }

    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
    const timer = window.setInterval(() => {
      setRefreshCountdown((current) =>
        current <= 1 ? JOB_HISTORY_REFRESH_INTERVAL_SECONDS : current - 1
      );
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (autoRefresh && dataUpdatedAt) {
      setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
    }
  }, [autoRefresh, dataUpdatedAt]);

  return { refreshCountdown, setRefreshCountdown };
}

/** Job History auto-refresh: persisted preference, default on. */
export function useJobHistoryAutoRefresh(options?: { dataUpdatedAt?: number }) {
  const [autoRefresh, setAutoRefresh] = useState(() => readJobHistoryAutoRefreshPreference());
  const { refreshCountdown, setRefreshCountdown } = useAutoRefreshCountdown(autoRefresh, options?.dataUpdatedAt);

  useEffect(() => {
    writeJobHistoryAutoRefreshPreference(autoRefresh);
  }, [autoRefresh]);

  return {
    autoRefresh,
    setAutoRefresh,
    refreshCountdown,
    setRefreshCountdown,
    refreshIntervalMs: JOB_HISTORY_REFRESH_INTERVAL_MS
  };
}
