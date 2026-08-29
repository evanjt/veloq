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
  /**
   * Bumped once the engine is open and usable. Effects that need a live
   * engine but mount before the root layout's init effect runs depend on it,
   * so they retry the moment the handle exists instead of latching on a
   * call that never reached Rust.
   */
  readyNonce: number;
  markEngineReady: () => void;
}

export const useEngineStatus = create<EngineStatusState>((set) => ({
  initFailed: false,
  setInitFailed: (v: boolean) => set({ initFailed: v }),
  engineBannerDismissed: false,
  setEngineBannerDismissed: (v: boolean) => set({ engineBannerDismissed: v }),
  retryNonce: 0,
  requestRetry: () => set((s) => ({ retryNonce: s.retryNonce + 1 })),
  readyNonce: 0,
  markEngineReady: () => set((s) => ({ readyNonce: s.readyNonce + 1 })),
}));
