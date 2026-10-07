import * as FileSystem from 'expo-file-system/legacy';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface VeloqReplaceFileModule {
  replaceFile(from: string, to: string): void;
}

function plainPath(path: string): string {
  return path.startsWith('file://') ? path.slice(7) : path;
}

/**
 * Move a file over an existing destination so the destination is either the
 * old file or the new one at every instant.
 *
 * On iOS the file system API's move deletes the destination and then moves,
 * so a kill or an I/O failure between the two leaves neither file. The native
 * call is a single `rename(2)` on the same volume, and a failed rename leaves
 * the destination as it was. Android's move is a `rename` already. A build
 * without the native module (a test host) uses the file system API.
 *
 * Takes plain paths or `file://` URIs. Rejects when the replace fails.
 */
export async function replaceFile(from: string, to: string): Promise<void> {
  if (Platform.OS === 'ios') {
    const mod = requireOptionalNativeModule<VeloqReplaceFileModule>('VeloqBackupExclusion');
    if (mod) {
      mod.replaceFile(plainPath(from), plainPath(to));
      return;
    }
  }
  await FileSystem.moveAsync({ from, to });
}
