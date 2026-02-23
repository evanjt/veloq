import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '../utils/debug';
import type { UploadQueueEntry } from '@/types';

const log = debug.create('UploadQueue');

const UPLOADS_DIR = `${FileSystem.documentDirectory}pending_uploads/`;
const QUEUE_KEY = 'veloq-upload-queue';

async function ensureUploadsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(UPLOADS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(UPLOADS_DIR, { intermediates: true });
    log.log('Created pending uploads directory');
  }
}

async function loadQueue(): Promise<UploadQueueEntry[]> {
  try {
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as UploadQueueEntry[];
  } catch {
    return [];
  }
}

async function saveQueue(queue: UploadQueueEntry[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueUpload(
  entry: Omit<UploadQueueEntry, 'id' | 'retryCount'>
): Promise<string> {
  await ensureUploadsDir();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullEntry: UploadQueueEntry = { ...entry, id, retryCount: 0 };
  const queue = await loadQueue();
  queue.push(fullEntry);
  await saveQueue(queue);
  log.log(`Enqueued upload: ${id}`);
  return id;
}

export async function dequeueUpload(): Promise<UploadQueueEntry | null> {
  const queue = await loadQueue();
  if (queue.length === 0) return null;
  return queue[0];
}

export async function markUploadComplete(id: string): Promise<void> {
  const queue = await loadQueue();
  const entry = queue.find((e) => e.id === id);
  const updated = queue.filter((e) => e.id !== id);
  await saveQueue(updated);

  // Clean up the file
  if (entry) {
    try {
      const info = await FileSystem.getInfoAsync(entry.filePath);
      if (info.exists) {
        await FileSystem.deleteAsync(entry.filePath, { idempotent: true });
      }
    } catch {
      // Best effort cleanup
    }
  }

  log.log(`Upload complete: ${id}`);
}

export async function markUploadFailed(id: string, error: string): Promise<void> {
  const queue = await loadQueue();
  const updated = queue.map((e) =>
    e.id === id ? { ...e, retryCount: e.retryCount + 1, lastError: error } : e
  );
  await saveQueue(updated);
  log.log(`Upload failed: ${id} (${error})`);
}

export async function getQueueSize(): Promise<number> {
  const queue = await loadQueue();
  return queue.length;
}

export async function clearUploadQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  try {
    const dirInfo = await FileSystem.getInfoAsync(UPLOADS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(UPLOADS_DIR, { idempotent: true });
      log.log('Cleared upload queue and files');
    }
  } catch {
    // Best effort cleanup
  }
}
