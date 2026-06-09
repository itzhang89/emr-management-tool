import type { StartJobRunRequest } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const emrService = {
  listVirtualClusters: (region: string) => tauriClient.listVirtualClusters({ region }),
  listJobRuns: (virtualClusterId?: string) => tauriClient.listJobRuns({ virtualClusterId }),
  describeJobRun: (id: string, virtualClusterId: string) => tauriClient.describeJobRun({ id, virtualClusterId }),
  startJobRun: (request: StartJobRunRequest) => tauriClient.startJobRun(request),
  cancelJobRun: (id: string, virtualClusterId: string) => tauriClient.cancelJobRun({ id, virtualClusterId })
};
