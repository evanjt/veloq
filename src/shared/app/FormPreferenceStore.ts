/**
 * Whether the athlete reads form as a percentage of fitness.
 *
 * `icu_form_as_percent` is one of the 162 keys the athlete record carries, and
 * it decides what the form number on every screen means: an absolute TSB, or
 * TSB as a share of CTL. It is lifted off the profile the same way the unit
 * preferences are, and kept in a store rather than a hook because
 * `widgetSnapshot.ts` reads it and is not a component. It sits beside
 * `UnitPreferenceStore`, which lifts the unit preferences off the same record.
 */
import { create } from 'zustand';

interface FormPreferenceState {
  /** Null until an athlete profile has been read. Absent reads as absolute. */
  formAsPercent: boolean | null;
  /** Returns whether the value moved, which is what a rebuild keys on. */
  setFormAsPercent: (asPercent: boolean) => boolean;
}

export const useFormPreference = create<FormPreferenceState>((set, get) => ({
  formAsPercent: null,
  setFormAsPercent: (asPercent) => {
    if (get().formAsPercent === asPercent) return false;
    set({ formAsPercent: asPercent });
    return true;
  },
}));

/** The same answer for a caller that is not a component. */
export function formAsPercent(): boolean {
  return useFormPreference.getState().formAsPercent === true;
}
