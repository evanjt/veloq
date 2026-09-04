/**
 * Write content to a temp file and share via OS share sheet.
 * expo-sharing is lazy-loaded to avoid crashing when the native module
 * isn't linked (e.g. iOS simulator without a full rebuild).
 */

import * as FileSystem from 'expo-file-system/legacy';

async function getSharing() {
  const Sharing = await import('expo-sharing');
  return Sharing;
}

interface ShareFileParams {
  content: string;
  filename: string;
  mimeType: string;
}

export async function shareFile({ content, filename, mimeType }: ShareFileParams): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await shareExistingFile(fileUri, mimeType);
}

/** Share a file already on disk, through the same lazy-loaded share sheet. */
export async function shareExistingFile(fileUri: string, mimeType: string): Promise<void> {
  const Sharing = await getSharing();
  await Sharing.shareAsync(fileUri, { mimeType, UTI: mimeType });
}
