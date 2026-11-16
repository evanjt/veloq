/**
 * The athlete's choice to keep a library filled from activity files, with no
 * connector and no account.
 *
 * Every other session is a credential in the keychain. This one has none, so
 * the choice itself is stored, in AsyncStorage rather than the keychain: the
 * keychain outlives an uninstall on iOS, and a reinstall must open on the
 * sign-in screen, not on a library that is no longer there. Any sign-in,
 * sign-out or sign-out that deletes the data removes it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const FILES_SESSION_KEY = 'files_source_session';

export async function rememberFilesSession(): Promise<void> {
  try {
    await AsyncStorage.setItem(FILES_SESSION_KEY, '1');
  } catch {
    // The session lasts until the app closes; the next launch asks again.
  }
}

export async function forgetFilesSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FILES_SESSION_KEY);
  } catch {
    // Best-effort, as above.
  }
}

/** False for a device that never chose one, and for a read that failed. */
export async function readFilesSession(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FILES_SESSION_KEY)) === '1';
  } catch {
    return false;
  }
}
