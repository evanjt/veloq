import { useCallback, useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { FfiImportPhase, type FfiImportProgress } from 'veloqrs';

import {
  cancelCollectionImport,
  readImportProgress,
  startCollectionImport,
} from '@/shared/native/collectionImport';
import { IMPORT_STAGING_DIR, isPickerCopy } from '@/shared/storage/cacheFiles';

/** How often a running import is read again, in milliseconds. */
const FOLLOW_MS = 1000;

/** Where an import has stopped reading: the job walked everything or ended early. */
function isSettled(progress: FfiImportProgress): boolean {
  return progress.phase !== FfiImportPhase.Running;
}

async function stage(uris: { uri: string; name: string }[]): Promise<string> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Device storage not available');
  const dir = `${cacheDir}${IMPORT_STAGING_DIR}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  for (const { uri, name } of uris) {
    const to = `${dir}/${name}`;
    // A picker copy is the app's own to move; a folder's entries belong to the athlete.
    if (isPickerCopy(uri)) await FileSystem.moveAsync({ from: uri, to });
    else await FileSystem.copyAsync({ from: uri, to });
  }
  return dir;
}

/**
 * A collection import from a pick: files, an archive or, on Android, a folder. The pick is handed
 * to the engine's job in one call and the job is read once a second until it settles. Every copy
 * the pick made is deleted when the job ends, is cancelled or never starts.
 */
export function useImportCollection() {
  const [progress, setProgress] = useState<FfiImportProgress | undefined>();
  const [running, setRunning] = useState(false);
  const [refused, setRefused] = useState(false);
  const copies = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopFollowing = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const deleteCopies = useCallback(async () => {
    const held = copies.current;
    copies.current = [];
    await Promise.all(
      held.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}))
    );
  }, []);

  const read = useCallback(() => {
    const next = readImportProgress();
    setProgress(next);
    if (isSettled(next)) {
      stopFollowing();
      setRunning(false);
      void deleteCopies();
    }
  }, [deleteCopies, stopFollowing]);

  useEffect(() => stopFollowing, [stopFollowing]);

  const begin = useCallback(
    (uri: string, owned: string[]) => {
      copies.current = owned;
      setRefused(false);
      if (!startCollectionImport(uri)) {
        setRefused(true);
        void deleteCopies();
        return;
      }
      setRunning(true);
      read();
      if (!timer.current) timer.current = setInterval(read, FOLLOW_MS);
    },
    [deleteCopies, read]
  );

  const pick = useCallback(
    async (options: DocumentPicker.DocumentPickerOptions, gather: boolean) => {
      if (running) return;
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        ...options,
      });
      if (result.canceled || !result.assets?.length) return;
      const assets = result.assets;
      const [firstAsset] = assets;
      if (!firstAsset) return;
      if (!gather) {
        begin(firstAsset.uri, isPickerCopy(firstAsset.uri) ? [firstAsset.uri] : []);
        return;
      }
      const dir = await stage(assets.map((a) => ({ uri: a.uri, name: a.name })));
      begin(dir, [dir]);
    },
    [begin, running]
  );

  const pickFiles = useCallback(() => pick({ multiple: true, type: '*/*' }, true), [pick]);
  const pickArchive = useCallback(
    () =>
      pick({ multiple: false, type: ['application/zip', 'application/x-zip-compressed'] }, false),
    [pick]
  );

  const pickFolder = useCallback(async () => {
    if (running) return;
    const saf = FileSystem.StorageAccessFramework;
    const granted = await saf.requestDirectoryPermissionsAsync();
    if (!granted.granted) return;
    const entries = await saf.readDirectoryAsync(granted.directoryUri);
    if (!entries.length) return;
    const dir = await stage(
      entries.map((uri) => ({
        uri,
        name: decodeURIComponent(uri.split(/%2F|\//).pop() ?? uri),
      }))
    );
    begin(dir, [dir]);
  }, [begin, running]);

  const cancel = useCallback(() => {
    cancelCollectionImport();
  }, []);

  return { progress, running, refused, pickFiles, pickArchive, pickFolder, cancel };
}
