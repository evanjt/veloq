// Where a pulled archive is saved: a file stream where the browser offers a save picker, else
// memory until the end, then the browser's own download.

import type { ArchiveSink } from './exportArchive';

interface WritableFile {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableFile> }>;

/** Whether this browser can write a file as it arrives. */
export function hasFilePicker(host: object = window): boolean {
  return typeof (host as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

/** A sink that holds the chunks and hands the browser one file when it is closed. */
export function memorySink(name: string, save: (name: string, blob: Blob) => void): ArchiveSink {
  let chunks: Uint8Array<ArrayBuffer>[] = [];
  return {
    async write(bytes) {
      chunks.push(bytes.slice());
    },
    async close() {
      save(name, new Blob(chunks, { type: 'application/zip' }));
      chunks = [];
    },
    async abort() {
      chunks = [];
    },
  };
}

/** Save `blob` as a file called `name`: the browser's own download. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The sink for a file called `name`. The picker needs the click that asked for
 * it, so call this before anything is awaited; the athlete dismissing it
 * rejects, and nothing has been asked of the phone.
 */
export async function openSink(name: string, host: object = window): Promise<ArchiveSink> {
  if (!hasFilePicker(host)) return memorySink(name, saveBlob);
  const pick = (host as { showSaveFilePicker: SavePicker }).showSaveFilePicker.bind(host);
  const handle = await pick({
    suggestedName: name,
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  });
  const file = await handle.createWritable();
  return {
    write: (bytes) => file.write(bytes),
    close: () => file.close(),
    abort: () => file.abort(),
  };
}
