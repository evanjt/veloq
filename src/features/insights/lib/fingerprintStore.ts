/** The single home for the insights fingerprint. The foreground store and the
 *  headless background task both read and write it here, so a background run
 *  cannot advance a copy the next `initialize()` never sees. */
import { getSetting, setSetting } from '@/shared/storage/settingsStorage';

const FINGERPRINT_KEY = 'veloq-insights-fingerprint';

export async function readInsightFingerprint(): Promise<string> {
  const stored = await getSetting(FINGERPRINT_KEY);
  return typeof stored === 'string' ? stored : '';
}

export async function writeInsightFingerprint(fingerprint: string): Promise<void> {
  await setSetting(FINGERPRINT_KEY, fingerprint);
}
