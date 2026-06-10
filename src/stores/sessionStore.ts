import { create } from "zustand";
import type { StartJobRunRequest } from "@/types/domain";

interface SessionState {
  region: string;
  selectedVirtualClusterId?: string;
  selectedJobId?: string;
  selectedJobLogGroupName?: string;
  selectedJobLogStreamNamePrefix?: string;
  clonedJobRequest?: StartJobRunRequest;
  setRegion: (region: string) => void;
  setSelectedVirtualClusterId: (id?: string) => void;
  setSelectedJobId: (id?: string) => void;
  setSelectedJobForLogs: (jobId: string, logGroupName?: string, streamNamePrefix?: string) => void;
  setClonedJobRequest: (request?: StartJobRunRequest) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  region: "us-east-1",
  selectedVirtualClusterId: undefined,
  selectedJobId: undefined,
  selectedJobLogGroupName: undefined,
  selectedJobLogStreamNamePrefix: undefined,
  clonedJobRequest: undefined,
  setRegion: (region) => set({ region }),
  setSelectedVirtualClusterId: (selectedVirtualClusterId) => set({ selectedVirtualClusterId }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setSelectedJobForLogs: (selectedJobId, selectedJobLogGroupName, selectedJobLogStreamNamePrefix) =>
    set({ selectedJobId, selectedJobLogGroupName, selectedJobLogStreamNamePrefix }),
  setClonedJobRequest: (clonedJobRequest) => set({ clonedJobRequest })
}));
