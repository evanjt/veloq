import { create } from 'zustand';

interface UploadPermissionState {
  needsUpgrade: boolean;
  setNeedsUpgrade: (v: boolean) => void;
}

export const useUploadPermissionStore = create<UploadPermissionState>((set) => ({
  needsUpgrade: false,
  setNeedsUpgrade: (v) => set({ needsUpgrade: v }),
}));
