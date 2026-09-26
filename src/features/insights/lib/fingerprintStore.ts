/** The single home for the insights fingerprint. The foreground store and the
 *  headless background task both read and write it here, so a background run
 *  cannot advance a copy the next `initialize()` never sees. */
import { getSetting, setSetting, removeSetting } from '@/shared/storage/settingsStorage';

const FINGERPRINT_KEY = 'veloq-insights-fingerprint';

export async function readInsightFingerprint(): Promise<string> {
  const stored = await getSetting(FINGERPRINT_KEY);
  return typeof stored === 'string' ? stored : '';
}

export async function writeInsightFingerprint(fingerprint: string): Promise<void> {
  await setSetting(FINGERPRINT_KEY, fingerprint);
}

/**
 * Forget it, for an account wipe.
 *
 * The fingerprint is the set of insight ids the athlete has already been shown,
 * and six of those ids are constants rather than being keyed to a section or an
 * activity: `hrv_trend`, `period_comparison-volume`, the three
 * `fitness_milestone-*` and `stale_pr-group`. Left behind, they are the ids the
 * next athlete on the device never gets told about.
 */
export async function forgetInsightFingerprint(): Promise<void> {
  await removeSetting(FINGERPRINT_KEY);
}
