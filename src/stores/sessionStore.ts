import { create } from "zustand";
import type { JobAnalyzeIntent } from "@/services/aiAnalyzeJob";
import type { StartJobPayloadJson } from "@/services/startJobPayload";
import type { StartJobRunRequest } from "@/types/domain";

/** A failed job the user asked the AI assistant to analyze from Job History. */
export type PendingAiAnalyze = JobAnalyzeIntent;

interface SessionState {
  region: string;
  selectedVirtualClusterId?: string;
  selectedJobId?: string;
  selectedJobVirtualClusterId?: string;
  selectedS3Bucket?: string;
  selectedS3Prefix?: string;
  clonedJobRequest?: StartJobRunRequest;
  pendingSourceSubmit?: { payload: StartJobPayloadJson; virtualClusterId: string };
  pendingAiAnalyze?: PendingAiAnalyze;
  setRegion: (region: string) => void;
  setSelectedVirtualClusterId: (id?: string) => void;
  setSelectedJobId: (id?: string) => void;
  setSelectedJobForLogs: (jobId: string, virtualClusterId?: string) => void;
  setSelectedS3Location: (bucket: string, prefix?: string) => void;
  setClonedJobRequest: (request?: StartJobRunRequest) => void;
  setPendingSourceSubmit: (value?: { payload: StartJobPayloadJson; virtualClusterId: string }) => void;
  setPendingAiAnalyze: (value?: PendingAiAnalyze) => void;
  resetAccountScopedSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  region: "us-east-1",
  selectedVirtualClusterId: undefined,
  selectedJobId: undefined,
  selectedJobVirtualClusterId: undefined,
  selectedS3Bucket: undefined,
  selectedS3Prefix: undefined,
  clonedJobRequest: undefined,
  pendingSourceSubmit: undefined,
  setRegion: (region) => set({ region }),
  setSelectedVirtualClusterId: (selectedVirtualClusterId) => set({ selectedVirtualClusterId }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setSelectedJobForLogs: (selectedJobId, selectedJobVirtualClusterId) =>
    set({
      selectedJobId,
      selectedJobVirtualClusterId,
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    }),
  setSelectedS3Location: (selectedS3Bucket, selectedS3Prefix) => set({ selectedS3Bucket, selectedS3Prefix }),
  setClonedJobRequest: (clonedJobRequest) => set({ clonedJobRequest }),
  setPendingSourceSubmit: (pendingSourceSubmit) => set({ pendingSourceSubmit }),
  setPendingAiAnalyze: (pendingAiAnalyze) => set({ pendingAiAnalyze }),
  resetAccountScopedSession: () =>
    set({
      selectedVirtualClusterId: undefined,
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined,
      clonedJobRequest: undefined,
      pendingSourceSubmit: undefined,
      pendingAiAnalyze: undefined
    })
}));
