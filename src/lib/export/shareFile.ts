/**
 * Write content to a temp file and share via OS share sheet.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

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
  await Sharing.shareAsync(fileUri, { mimeType, UTI: mimeType });
}
