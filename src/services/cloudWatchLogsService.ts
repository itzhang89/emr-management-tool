import { tauriClient } from "./tauriClient";
import type { JobLogStreamsRequest, JobLogsRequest } from "@/types/domain";

export const cloudWatchLogsService = {
  listJobLogStreams: (request: JobLogStreamsRequest) => tauriClient.listJobLogStreams(request),
  getJobLogs: (request: JobLogsRequest) => tauriClient.getJobLogs(request)
};
