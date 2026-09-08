import { create } from 'zustand';

/**
 * Live values the recording session produces and the screen only displays.
 * They are not part of the recorded activity, so they live beside the
 * recording store rather than in it, and they survive the screen unmounting
 * because the session that writes them does.
 */
interface RecordingLiveState {
  currentLocation: { latitude: number; longitude: number } | null;
  accuracy: number | null;
  /** Wall time of the last location callback, any accuracy. Null before the first fix. */
  lastFixAt: number | null;
  /** True while the pause was taken by the auto-pause detector, not the rider. */
  autoPaused: boolean;
  /**
   * True when the foreground service the ride needs to keep recording off
   * screen was refused. The ride still records while the screen is up, so this
   * is a warning and not a failure, but it does not clear on the next fix the
   * way a signal warning does: fixes keep arriving in the foreground, which is
   * exactly the state that hides the problem.
   */
  backgroundTrackingFailed: boolean;
  setFix: (location: { latitude: number; longitude: number }, accuracy: number | null) => void;
  setAutoPaused: (autoPaused: boolean) => void;
  setBackgroundTrackingFailed: (failed: boolean) => void;
  reset: () => void;
}

export const useRecordingLiveStore = create<RecordingLiveState>((set) => ({
  currentLocation: null,
  accuracy: null,
  lastFixAt: null,
  autoPaused: false,
  backgroundTrackingFailed: false,

  setFix: (location, accuracy) => {
    set({ currentLocation: location, accuracy, lastFixAt: Date.now() });
  },

  setAutoPaused: (autoPaused) => set({ autoPaused }),

  setBackgroundTrackingFailed: (backgroundTrackingFailed) => set({ backgroundTrackingFailed }),

  reset: () =>
    set({
      currentLocation: null,
      accuracy: null,
      lastFixAt: null,
      autoPaused: false,
      backgroundTrackingFailed: false,
    }),
}));
