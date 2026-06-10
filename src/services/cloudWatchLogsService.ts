import { tauriClient } from "./tauriClient";
import type { JobLogsRequest } from "@/types/domain";

export const cloudWatchLogsService = {
  getJobLogs: (request: JobLogsRequest) => tauriClient.getJobLogs(request)
};
