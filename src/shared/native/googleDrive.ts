import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Google's authorisation for Veloq's own app data folder in the athlete's
 * Google Drive, on Android. The native side asks Google Play services for the
 * `drive.appdata` scope alone: the first time through the system account picker
 * and consent screen, after that silently. Play services holds the grant and
 * refreshes the token, so the app persists no token of its own.
 */

/** The native side refused a silent request: the athlete has to sign in again. */
export const GOOGLE_SIGN_IN_NEEDED = 'ERR_GOOGLE_SIGN_IN_NEEDED';
/** The athlete dismissed the account picker or the consent screen. */
export const GOOGLE_SIGN_IN_CANCELLED = 'ERR_GOOGLE_SIGN_IN_CANCELLED';

interface VeloqGoogleDriveModule {
  authorizeGoogleDrive(interactive: boolean): Promise<string>;
  clearGoogleDriveToken(token: string): Promise<void>;
}

function nativeModule(): VeloqGoogleDriveModule | null {
  if (Platform.OS !== 'android') return null;
  const mod = requireOptionalNativeModule<Partial<VeloqGoogleDriveModule>>('VeloqBackupExclusion');
  return mod?.authorizeGoogleDrive && mod.clearGoogleDriveToken
    ? (mod as VeloqGoogleDriveModule)
    : null;
}

/** Whether this build on this platform can reach Google Drive. */
export function isGoogleDriveSupported(): boolean {
  return nativeModule() !== null;
}

/** The native refusal code an authorisation threw, or null for any other error. */
export function googleAuthorizationCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * An access token for the app data folder. `interactive` shows the account
 * picker and consent screen when Google needs them; without it a missing grant
 * throws `GOOGLE_SIGN_IN_NEEDED` and nothing is shown.
 */
export async function authorizeGoogleDrive(interactive: boolean): Promise<string> {
  const mod = nativeModule();
  if (!mod) throw new Error('Google Drive is not available in this build');
  return mod.authorizeGoogleDrive(interactive);
}

/** Drop a token from Play services' cache, so the next request fetches a fresh one. */
export async function clearGoogleDriveToken(token: string): Promise<void> {
  await nativeModule()?.clearGoogleDriveToken(token);
}
