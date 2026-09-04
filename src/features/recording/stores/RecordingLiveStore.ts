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
  setFix: (location: { latitude: number; longitude: number }, accuracy: number | null) => void;
  setAutoPaused: (autoPaused: boolean) => void;
  reset: () => void;
}

export const useRecordingLiveStore = create<RecordingLiveState>((set) => ({
  currentLocation: null,
  accuracy: null,
  lastFixAt: null,
  autoPaused: false,

  setFix: (location, accuracy) => {
    set({ currentLocation: location, accuracy, lastFixAt: Date.now() });
  },

  setAutoPaused: (autoPaused) => set({ autoPaused }),

  reset: () => set({ currentLocation: null, accuracy: null, lastFixAt: null, autoPaused: false }),
}));
