import { useEffect, useState } from "react";
import {
  JOB_HISTORY_REFRESH_INTERVAL_SECONDS,
  JOB_HISTORY_REFRESH_INTERVAL_MS
} from "@/services/jobHistoryConstants";
import { readAutoRefreshPreference, writeAutoRefreshPreference } from "@/services/jobHistoryPreferences";

export function useJobHistoryAutoRefresh(options?: {
  enabled?: boolean;
  persistPreference?: boolean;
}) {
  const enabled = options?.enabled ?? true;
  const [autoRefresh, setAutoRefresh] = useState(() => readAutoRefreshPreference());
  const [refreshCountdown, setRefreshCountdown] = useState(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);

  useEffect(() => {
    if (!enabled || !options?.persistPreference) return;
    writeAutoRefreshPreference(autoRefresh);
  }, [autoRefresh, enabled, options?.persistPreference]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [autoRefresh, enabled]);

  return {
    autoRefresh,
    setAutoRefresh,
    refreshCountdown,
    setRefreshCountdown,
    refreshIntervalMs: JOB_HISTORY_REFRESH_INTERVAL_MS
  };
}
