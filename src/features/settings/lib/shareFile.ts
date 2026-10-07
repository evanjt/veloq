/**
 * Write content to a temp file and share via OS share sheet.
 * expo-sharing is lazy-loaded to avoid crashing when the native module
 * isn't linked (e.g. iOS simulator without a full rebuild).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { exportFileUri } from '@/shared/storage/cacheFiles';

function getSharing(): typeof import('expo-sharing') {
  return require('expo-sharing');
}

interface ShareFileParams {
  content: string;
  filename: string;
  mimeType: string;
}

export async function shareFile({ content, filename, mimeType }: ShareFileParams): Promise<void> {
  const fileUri = await exportFileUri(filename);
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await shareExistingFile(fileUri, mimeType);
}

/**
 * Share a file already on disk, through the same lazy-loaded share sheet.
 *
 * `uti` is iOS's own type identifier and is what its share targets filter on.
 * It defaults to the MIME type, which is what a caller with no better answer
 * was passing anyway.
 */
export async function shareExistingFile(
  fileUri: string,
  mimeType: string,
  uti: string = mimeType
): Promise<void> {
  const Sharing = getSharing();
  await Sharing.shareAsync(fileUri, { mimeType, UTI: uti });
}
