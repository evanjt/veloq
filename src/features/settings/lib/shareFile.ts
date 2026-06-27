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
  const Sharing = await getSharing();
  await Sharing.shareAsync(fileUri, { mimeType, UTI: mimeType });
}

interface ShareFileBase64Params {
  base64: string;
  filename: string;
  mimeType: string;
}

export async function shareFileBase64({
  base64,
  filename,
  mimeType,
}: ShareFileBase64Params): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const Sharing = await getSharing();
  await Sharing.shareAsync(fileUri, { mimeType, UTI: mimeType });
}
