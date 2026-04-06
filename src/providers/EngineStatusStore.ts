import { create } from 'zustand';

interface EngineStatusState {
  /** Whether the Rust engine failed to initialize after all retries */
  initFailed: boolean;
  setInitFailed: (v: boolean) => void;
}

export const useEngineStatus = create<EngineStatusState>((set) => ({
  initFailed: false,
  setInitFailed: (v: boolean) => set({ initFailed: v }),
}));
