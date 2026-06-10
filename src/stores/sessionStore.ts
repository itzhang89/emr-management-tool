import { create } from "zustand";
import type { StartJobRunRequest } from "@/types/domain";

interface SessionState {
  region: string;
  selectedVirtualClusterId?: string;
  selectedJobId?: string;
  clonedJobRequest?: StartJobRunRequest;
  setRegion: (region: string) => void;
  setSelectedVirtualClusterId: (id?: string) => void;
  setSelectedJobId: (id?: string) => void;
  setClonedJobRequest: (request?: StartJobRunRequest) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  region: "us-east-1",
  selectedVirtualClusterId: undefined,
  selectedJobId: undefined,
  clonedJobRequest: undefined,
  setRegion: (region) => set({ region }),
  setSelectedVirtualClusterId: (selectedVirtualClusterId) => set({ selectedVirtualClusterId }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setClonedJobRequest: (clonedJobRequest) => set({ clonedJobRequest })
}));
