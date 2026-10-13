/**
 * The platform's per-app language. Android 13 and later keeps one for each app, set from the
 * system's App languages page or by the app, and applies it to every native string the app draws.
 * Elsewhere there is none to read or write, and each call answers null or does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface VeloqLocaleModule {
  /** The per-app language as a BCP 47 list, '' when the app follows the phone; null below API 33. */
  getApplicationLocales(): string | null;
  /** The phone's own languages, ignoring the per-app one; null below API 33. */
  getSystemLocales(): string[] | null;
  /** Set the per-app language, or clear it with ''. Does nothing below API 33. */
  setApplicationLocales(tags: string): void;
}

const VeloqLocale = requireOptionalNativeModule<VeloqLocaleModule>('VeloqLocale');

/** The per-app language tag, '' when the app follows the phone, or null where the platform keeps none. */
export function readPlatformLanguage(): string | null {
  try {
    const tags = VeloqLocale?.getApplicationLocales() ?? null;
    return tags === null ? null : (tags.split(',')[0] ?? '');
  } catch {
    return null;
  }
}

/** The phone's languages in preference order, or null where the platform keeps no per-app one. */
export function readSystemLocales(): string[] | null {
  try {
    return VeloqLocale?.getSystemLocales() ?? null;
  } catch {
    return null;
  }
}

/** Write the per-app language, '' to follow the phone. */
export function writePlatformLanguage(tag: string): void {
  try {
    VeloqLocale?.setApplicationLocales(tag);
  } catch {
    // The in-app language still applies; only native strings keep the phone's.
  }
}
