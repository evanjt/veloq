import { useAthlete } from '@/shared/app/useAthlete';

/**
 * Reads the athlete profile once the app is up, whatever screen opens first.
 * The form-as-percent flag is lifted into its store as a side effect of that
 * read, and Home and the widget snapshot depend on it before any screen that
 * reads the athlete has mounted.
 */
export function useFormPreferenceAtLaunch(): void {
  useAthlete();
}
