/**
 * Pulling the library archive from the phone over the data channel.
 *
 * The phone writes the archive to a spool (`export.begin`), reports how far
 * the build has got and, once it is whole, its length and SHA-256
 * (`export.status`), and answers a range of it as raw frames (`export.read`,
 * at most `READ_BYTES` an ask). The page writes each range to a sink as it
 * arrives, so it holds one range and a handle, never the archive. The phone
 * keeps no count of what was read: after a dropped link the page calls
 * `pullArchive` again with the same `PullState`, and it reads on from the
 * bytes written once `export.status` confirms the same export and digest.
 * The bytes are hashed as they are written, and a digest that differs from the
 * phone's aborts the sink before `export.done`.
 * `export.done` follows the last byte.
 */

import { Sha256 } from './upload';

/** The most the phone answers to one `export.read`. */
export const READ_BYTES = 1024 * 1024;

/** How long to wait between asks of a build that is not ready. */
const POLL_MS = 1000;

/** Where the pulled bytes go: a file stream, or memory held until the end. */
export interface ArchiveSink {
  write(bytes: Uint8Array): Promise<void>;
  /** Finish the file: every byte has been written. */
  close(): Promise<void>;
  /** Throw the partial file away. */
  abort(): Promise<void>;
}

/** What a pull keeps across a dropped link. */
export interface PullState {
  exportId: string | null;
  sha256: string | null;
  /** The archive's length, from the `export.status` that found it ready. */
  bytes: number;
  /** Bytes the sink holds. */
  written: number;
  /** SHA-256 over the `written` bytes, kept across a resume. */
  hash?: Sha256;
}

export interface PullProgress {
  /** The phone is still writing the archive, so `bytes` is what it has so far. */
  building: boolean;
  rides: number;
  ridesDone: number;
  written: number;
  bytes: number;
}

export interface ExportOptions {
  /** Unix seconds: keep rides that start at this time or later; all when null. */
  since: number | null;
  /** Include each ride's kept original file. */
  originals: boolean;
}

export interface PullArchive {
  ask: (method: string, params: object) => Promise<unknown>;
  sink: ArchiveSink;
  state: PullState;
  options: ExportOptions;
  onProgress: (progress: PullProgress) => void;
  pollMs?: number;
  signal?: AbortSignal;
}

type Status = Awaited<ReturnType<typeof statusOf>>;

async function statusOf(ask: PullArchive['ask'], exportId: string) {
  return (await ask('export.status', { exportId })) as {
    state: 'building' | 'ready' | 'failed';
    bytes: number;
    rides: number;
    ridesDone: number;
    sha256: string | null;
    error: string | null;
  };
}

class Abandoned extends Error {}

function stopped(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('export stopped');
}

/**
 * Pull the archive into `sink`, from `state.written`. A link that drops
 * rejects the call and leaves `state` and the sink as they are, for the same
 * call again. A failed build and a phone holding another archive abandon the
 * sink. Any other failure, a stop included, leaves it to the caller, who may
 * call again.
 */
export async function pullArchive(args: PullArchive): Promise<void> {
  const { ask, sink, state, signal } = args;
  try {
    stopped(signal);
    if (state.exportId === null) {
      const begun = (await ask('export.begin', args.options)) as { exportId: string };
      state.exportId = begun.exportId;
    }
    const exportId = state.exportId;
    let status: Status;
    for (;;) {
      stopped(signal);
      status = await statusOf(ask, exportId);
      if (status.state === 'failed') throw new Abandoned(status.error ?? 'the export failed');
      args.onProgress({
        building: status.state === 'building',
        rides: status.rides,
        ridesDone: status.ridesDone,
        written: state.written,
        bytes: status.bytes,
      });
      if (status.state === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? POLL_MS));
    }
    if (state.sha256 === null) {
      state.sha256 = status.sha256;
      state.bytes = status.bytes;
    } else if (state.sha256 !== status.sha256 || state.bytes !== status.bytes) {
      throw new Abandoned('the phone holds a different export now');
    }
    while (state.written < state.bytes) {
      stopped(signal);
      const length = Math.min(READ_BYTES, state.bytes - state.written);
      const bytes = await ask('export.read', { exportId, offset: state.written, length });
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
        throw new Abandoned('the phone answered a range of another length');
      }
      await sink.write(bytes);
      state.hash ??= new Sha256();
      state.hash.update(bytes);
      state.written += length;
      args.onProgress({
        building: false,
        rides: status.rides,
        ridesDone: status.ridesDone,
        written: state.written,
        bytes: state.bytes,
      });
    }
    const held = (state.hash ??= new Sha256()).hex();
    if (held !== state.sha256) {
      throw new Abandoned('the saved export does not match the phone’s digest');
    }
    await sink.close();
    // The spool is swept when nobody reads it, so a refusal here costs nothing.
    await ask('export.done', { exportId }).catch(() => undefined);
  } catch (error) {
    if (error instanceof Abandoned) await sink.abort();
    throw error;
  }
}
