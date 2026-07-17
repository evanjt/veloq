import { create } from 'zustand';

interface EngineStatusState {
  /** Whether the Rust engine failed to initialize after all retries */
  initFailed: boolean;
  setInitFailed: (v: boolean) => void;
  /** Whether the user dismissed the engine init failure banner */
  engineBannerDismissed: boolean;
  setEngineBannerDismissed: (v: boolean) => void;
  /**
   * Bumped by the failure banner's retry button. The root layout's init
   * effect depends on it, so a bump re-runs the full init sequence
   * (identity check, name translations, settings migration) rather than a
   * bare re-open.
   */
  retryNonce: number;
  requestRetry: () => void;
}

export const useEngineStatus = create<EngineStatusState>((set) => ({
  initFailed: false,
  setInitFailed: (v: boolean) => set({ initFailed: v }),
  engineBannerDismissed: false,
  setEngineBannerDismissed: (v: boolean) => set({ engineBannerDismissed: v }),
  retryNonce: 0,
  requestRetry: () => set((s) => ({ retryNonce: s.retryNonce + 1 })),
}));
