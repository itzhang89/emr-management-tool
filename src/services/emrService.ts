import type { ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const emrService = {
  listVirtualClusters: (request: ListVirtualClustersRequest = {}) => tauriClient.listVirtualClusters(request),
  listJobRuns: (virtualClusterId?: string, accountId?: string, keyword?: string) =>
    tauriClient.listJobRuns({ virtualClusterId, accountId, keyword }),
  describeJobRun: (id: string, virtualClusterId: string, accountId?: string) =>
    tauriClient.describeJobRun({ id, virtualClusterId, accountId }),
  startJobRun: (request: StartJobRunRequest) => tauriClient.startJobRun(request),
  cancelJobRun: (id: string, virtualClusterId: string, accountId?: string) =>
    tauriClient.cancelJobRun({ id, virtualClusterId, accountId })
};
