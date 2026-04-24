import { create } from 'zustand';

interface EngineStatusState {
  /** Whether the Rust engine failed to initialize after all retries */
  initFailed: boolean;
  setInitFailed: (v: boolean) => void;
  /** Whether the user dismissed the engine init failure banner */
  engineBannerDismissed: boolean;
  setEngineBannerDismissed: (v: boolean) => void;
}

export const useEngineStatus = create<EngineStatusState>((set) => ({
  initFailed: false,
  setInitFailed: (v: boolean) => set({ initFailed: v }),
  engineBannerDismissed: false,
  setEngineBannerDismissed: (v: boolean) => set({ engineBannerDismissed: v }),
}));
