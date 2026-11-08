import { getSetting, setSetting } from '@/shared/storage';
import { SMOOTHING_PRESETS, type SmoothingWindow } from '@/shared/math/smoothing';

/** The wellness smoothing choice on this device, listed in PREFERENCE_KEYS. */
export const WELLNESS_SMOOTHING_KEY = 'veloq-wellness-smoothing';

/** The window a stored value names, or Auto when it names none the window list holds. */
export function parseSmoothingWindow(value: string | null | undefined): SmoothingWindow {
  if (value === null || value === undefined) return 'auto';
  return SMOOTHING_PRESETS.find((preset) => String(preset.value) === value)?.value ?? 'auto';
}

/** The athlete's stored window, Auto when nothing is stored or the read fails. */
export async function readWellnessSmoothing(): Promise<SmoothingWindow> {
  try {
    return parseSmoothingWindow(await getSetting(WELLNESS_SMOOTHING_KEY));
  } catch {
    return 'auto';
  }
}

export function writeWellnessSmoothing(window: SmoothingWindow): Promise<void> {
  return setSetting(WELLNESS_SMOOTHING_KEY, String(window));
}
