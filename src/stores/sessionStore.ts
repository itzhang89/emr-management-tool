import { create } from "zustand";

interface SessionState {
  region: string;
  selectedVirtualClusterId?: string;
  selectedJobId?: string;
  setRegion: (region: string) => void;
  setSelectedVirtualClusterId: (id?: string) => void;
  setSelectedJobId: (id?: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  region: "us-east-1",
  selectedVirtualClusterId: undefined,
  selectedJobId: undefined,
  setRegion: (region) => set({ region }),
  setSelectedVirtualClusterId: (selectedVirtualClusterId) => set({ selectedVirtualClusterId }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId })
}));
