/**
 * Where a file the app wrote can go: the one owner of every export, backup and
 * recording that leaves the app, and of a file another app shares into it. On Android the athlete chooses between saving
 * it to the device, through the system's create-document screen, and the share
 * chooser, which has no save target of its own. On iOS the share sheet carries
 * Save to Files, so it opens straight away. Messages and links go through
 * `shareText` beside it, so every sheet takes the same anchor on iPad.
 *
 * expo-sharing is lazy-loaded to avoid crashing when the native module
 * isn't linked (e.g. iOS simulator without a full rebuild).
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { RefObject } from 'react';
import {
  findNodeHandle,
  Platform,
  Share,
  type ShareContent,
  type ShareOptions,
  type ViewInstance,
} from 'react-native';

import { i18n } from '@/i18n';
import { saveToDevice } from '@/shared/native/backupFolder';
import { exportFileUri } from '@/shared/storage/cacheFiles';
import { chooseAction } from '@/shared/ui/dialog';
import { SharingUnavailableError } from '@/shared/ui/shareFailure';

function getSharing(): typeof import('expo-sharing') {
  return require('expo-sharing');
}

/**
 * What a shared file is. iOS reads the type from the file name's extension and
 * Android filters the chooser by the MIME type, so both come from here.
 */
const SHARE_KINDS = {
  gpx: { mimeType: 'application/gpx+xml', extension: 'gpx' },
  zip: { mimeType: 'application/zip', extension: 'zip' },
  geojson: { mimeType: 'application/geo+json', extension: 'geojson' },
  fit: { mimeType: 'application/vnd.ant.fit', extension: 'fit' },
  text: { mimeType: 'text/plain', extension: 'txt' },
} as const;

export type ShareKind = keyof typeof SHARE_KINDS;

/**
 * The control that opened the share. On iPad the sheet is a popover and points
 * at it. A phone and Android ignore it.
 */
export type ShareAnchor = RefObject<ViewInstance | null>;

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How long a share waits on its anchor's measurement before opening without one. */
const ANCHOR_MEASURE_MS = 100;

function measureAnchor(anchor: ShareAnchor | undefined): Promise<AnchorRect | null> {
  const view = anchor?.current;
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => {
    // A view torn down mid-measure never answers, and the share must still open.
    const timer = setTimeout(() => resolve(null), ANCHOR_MEASURE_MS);
    try {
      view.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        resolve({ x, y, width, height });
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** The file name for `name`, ending in the kind's extension. */
function fileNameFor(name: string, kind: ShareKind): string {
  const extension = `.${SHARE_KINDS[kind].extension}`;
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

/** `name` with the characters a file system or share target refuses replaced. */
function readableFileName(name: string): string {
  return name.replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_').trim() || 'veloq';
}

interface ShareFileParams {
  content: string;
  /** The file name, with or without the kind's extension. */
  name: string;
  kind: ShareKind;
  anchor?: ShareAnchor | undefined;
}

export async function shareFile({ content, name, kind, anchor }: ShareFileParams): Promise<void> {
  const fileUri = await exportFileUri(fileNameFor(name, kind));
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await shareExistingFile(fileUri, kind, { anchor });
}

/**
 * Share a copy of a file whose name on disk is not readable, under `name`, and
 * delete the copy once the share has settled either way.
 */
export async function shareCopyAs(
  fileUri: string,
  kind: ShareKind,
  name: string,
  anchor?: ShareAnchor
): Promise<void> {
  const copyUri = await exportFileUri(fileNameFor(readableFileName(name), kind));
  await FileSystem.copyAsync({ from: fileUri, to: copyUri });
  try {
    await shareExistingFile(copyUri, kind, { anchor });
  } finally {
    await FileSystem.deleteAsync(copyUri, { idempotent: true });
  }
}

export interface ShareExistingFileOptions {
  /** The name the file is offered under, when the one on disk is not readable. */
  name?: string | undefined;
  anchor?: ShareAnchor | undefined;
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
 * gone, or when the athlete backed out, and rejects when a save failed. A
 * device with no share sheet throws `SharingUnavailableError` rather than
 * resolving as if the athlete cancelled.
 */
export async function shareExistingFile(
  fileUri: string,
  kind: ShareKind,
  options: ShareExistingFileOptions = {}
): Promise<void> {
  const { mimeType } = SHARE_KINDS[kind];
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
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const anchor = await measureAnchor(options.anchor);
  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: name,
    ...(anchor && { anchor }),
  });
}

/**
 * The file another app last shared into this one, taken so it is handed over
 * once. Null when the share carried no file.
 */
export async function takeSharedFile(): Promise<{ uri: string; name: string | null } | null> {
  const Sharing = getSharing();
  try {
    const payloads = await Sharing.getResolvedSharedPayloadsAsync();
    const file = payloads.find((payload) => payload.contentUri && payload.contentType === 'file');
    return file?.contentUri ? { uri: file.contentUri, name: file.originalName } : null;
  } finally {
    Sharing.clearSharedPayloads();
  }
}

function anchorTag(anchor: ShareAnchor | undefined): number | null {
  if (!anchor?.current) return null;
  try {
    return findNodeHandle(anchor.current) ?? null;
  } catch {
    return null;
  }
}

interface ShareTextOptions {
  /** The email subject on iOS, which ignores the content's title. */
  subject?: string;
  anchor?: ShareAnchor | undefined;
}

/**
 * Share a message or a link through the system's text sheet. Closing the sheet
 * resolves, so a rejection is a sheet that did not open.
 */
export async function shareText(
  content: ShareContent,
  { subject, anchor }: ShareTextOptions = {}
): Promise<void> {
  const tag = anchorTag(anchor);
  const options: ShareOptions = {
    ...(subject !== undefined && { subject }),
    ...(tag != null && { anchor: tag }),
  };
  await Share.share(content, options);
}
