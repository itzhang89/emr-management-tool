import { tauriClient } from "./tauriClient";

export const cloudWatchLogsService = {
  getJobLogs: (jobId: string, nextForwardToken?: string) => tauriClient.getJobLogs({ jobId, nextForwardToken })
};
