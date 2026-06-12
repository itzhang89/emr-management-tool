import { create } from "zustand";
import type { StartJobRunRequest } from "@/types/domain";

interface SessionState {
  region: string;
  selectedVirtualClusterId?: string;
  selectedJobId?: string;
  selectedJobLogGroupName?: string;
  selectedJobLogStreamNamePrefix?: string;
  selectedS3Bucket?: string;
  selectedS3Prefix?: string;
  clonedJobRequest?: StartJobRunRequest;
  setRegion: (region: string) => void;
  setSelectedVirtualClusterId: (id?: string) => void;
  setSelectedJobId: (id?: string) => void;
  setSelectedJobForLogs: (jobId: string, logGroupName?: string, streamNamePrefix?: string) => void;
  setSelectedS3Location: (bucket: string, prefix?: string) => void;
  setClonedJobRequest: (request?: StartJobRunRequest) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  region: "us-east-1",
  selectedVirtualClusterId: undefined,
  selectedJobId: undefined,
  selectedJobLogGroupName: undefined,
  selectedJobLogStreamNamePrefix: undefined,
  selectedS3Bucket: undefined,
  selectedS3Prefix: undefined,
  clonedJobRequest: undefined,
  setRegion: (region) => set({ region }),
  setSelectedVirtualClusterId: (selectedVirtualClusterId) => set({ selectedVirtualClusterId }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setSelectedJobForLogs: (selectedJobId, selectedJobLogGroupName, selectedJobLogStreamNamePrefix) =>
    set({
      selectedJobId,
      selectedJobLogGroupName,
      selectedJobLogStreamNamePrefix,
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    }),
  setSelectedS3Location: (selectedS3Bucket, selectedS3Prefix) => set({ selectedS3Bucket, selectedS3Prefix }),
  setClonedJobRequest: (clonedJobRequest) => set({ clonedJobRequest })
}));
