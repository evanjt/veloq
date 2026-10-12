/**
 * Where a file the app wrote can go: the one owner of every export, backup and
 * recording that leaves the app. On Android the athlete chooses between saving
 * it to the device, through the system's create-document screen, and the share
 * chooser, which has no save target of its own. On iOS the share sheet carries
 * Save to Files, so it opens straight away.
 *
 * expo-sharing is lazy-loaded to avoid crashing when the native module
 * isn't linked (e.g. iOS simulator without a full rebuild).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { i18n } from '@/i18n';
import { saveToDevice } from '@/shared/native/backupFolder';
import { exportFileUri } from '@/shared/storage/cacheFiles';
import { chooseAction } from '@/shared/ui/dialog';

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

export interface ShareExistingFileOptions {
  /**
   * iOS's own type identifier for the file. It defaults to the MIME type, which
   * is what a caller with no better answer was passing anyway.
   */
  uti?: string;
  /** The name the file is offered under, when the one on disk is not readable. */
  name?: string;
}

type Destination = 'save' | 'share' | null;

/** Ask where the file goes. A dismissal is a choice of neither. */
function askDestination(name: string): Promise<Destination> {
  return new Promise((resolve) => {
    chooseAction({
      title: name,
      actions: [
        { label: i18n.t('export.share'), onPress: () => resolve('share') },
        { label: i18n.t('export.saveToDevice'), onPress: () => resolve('save') },
      ],
      cancelLabel: i18n.t('common.cancel'),
      onCancel: () => resolve(null),
    });
  });
}

/**
 * Send a file already on disk where the athlete chooses. Settles once it has
 * gone, or when the athlete backed out, and rejects when a save failed.
 */
export async function shareExistingFile(
  fileUri: string,
  mimeType: string,
  options: ShareExistingFileOptions = {}
): Promise<void> {
  const name = options.name ?? fileUri.slice(fileUri.lastIndexOf('/') + 1);
  if (Platform.OS === 'android') {
    const destination = await askDestination(name);
    if (destination === null) return;
    if (destination === 'save') {
      await saveToDevice(fileUri, name, mimeType);
      return;
    }
  }
  const Sharing = getSharing();
  await Sharing.shareAsync(fileUri, {
    mimeType,
    UTI: options.uti ?? mimeType,
    ...(options.name !== undefined && { dialogTitle: options.name }),
  });
}
