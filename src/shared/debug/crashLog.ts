// On-device crash sink. Stores the last few crashes in AsyncStorage so users
// can share them, since the stores surface no crash reports for this app.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { crashLogHeader } from './crashProvenance';

const CRASH_LOG_KEY = 'veloq-crash-log';
const MAX_ENTRIES = 20;
// Rust panics arrive in bulk from a file, and one map renderer death is an
// entry for every map surface it carried, so each holds a bounded share of the
// log; JavaScript crashes keep the rest and are never displaced by them.
const MAX_RUST_ENTRIES = 10;
const MAX_RENDERER_ENTRIES = 5;

export type CrashSource = 'js-global' | 'react-boundary' | 'rust-panic' | 'webview-renderer';

export interface CrashEntry {
  ts: number;
  source: CrashSource;
  message: string;
  stack?: string | undefined;
  screen?: string;
  fatal?: boolean | undefined;
}

/**
 * A fatal crash is appended here synchronously, one JSON line each, since the
 * default handler hands it to native, which ends the process before any queued
 * storage call runs. The next load merges the lines into the log and deletes
 * the file once they are stored.
 */
const FATAL_CRASH_FILE = 'veloq-fatal-crash.json';

let currentScreen = 'unknown';
let cache: CrashEntry[] | null = null;

export function setCrashScreen(screen: string) {
  if (screen) currentScreen = screen;
}

/** Reads and writes run one at a time, so appends never replace one another. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function fatalCrashUri(): string {
  return `${FileSystem.documentDirectory}${FATAL_CRASH_FILE}`;
}

/**
 * Appends, so a fatal no load has merged yet is never written over. Throws when
 * the file cannot be written; the caller still has to reach the default handler.
 */
function writeFatalCrash(entry: CrashEntry) {
  // Loaded here because the native File class is only defined where the module is.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const uri = fatalCrashUri();
  new File(uri).write(`${JSON.stringify(entry)}\n`, { append: true });
}

/** The fatals earlier processes wrote and no load has stored yet. A torn last line is skipped. */
async function readFatalCrashes(): Promise<CrashEntry[]> {
  let raw: unknown;
  try {
    raw = await FileSystem.readAsStringAsync(fatalCrashUri());
  } catch {
    return [];
  }
  if (typeof raw !== 'string') return [];
  const entries: CrashEntry[] = [];
  for (const line of raw.split('\n')) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object') entries.push(value as CrashEntry);
    } catch {
      // An empty or torn line holds nothing to keep.
    }
  }
  return entries;
}

const sameEntry = (a: CrashEntry, b: CrashEntry) =>
  a.ts === b.ts && a.source === b.source && a.message === b.message;

/** Called once a write holding every line read from the file is stored, so each is merged once. */
async function deleteFatalCrashes(): Promise<void> {
  try {
    await FileSystem.deleteAsync(fatalCrashUri(), { idempotent: true });
  } catch {
    // A file left behind is merged once more and matched as already stored.
  }
}

/**
 * Rejects when storage cannot be read, or a pending fatal cannot be stored, and
 * caches nothing then, so a failed read is never written over and the fatal
 * file is kept for the next try.
 */
async function load(): Promise<CrashEntry[]> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(CRASH_LOG_KEY);
  let parsed: CrashEntry[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value as CrashEntry[];
    } catch {
      // A corrupt stored log is replaced by the next write.
    }
  }
  const fatals = await readFatalCrashes();
  const unmerged = fatals.filter((f) => !parsed.some((e) => sameEntry(e, f)));
  if (unmerged.length) {
    parsed = [...parsed, ...unmerged];
    trimToRetention(parsed);
    await AsyncStorage.setItem(CRASH_LOG_KEY, JSON.stringify(parsed));
  }
  if (fatals.length) await deleteFatalCrashes();
  cache = parsed;
  return cache;
}

function removeOldest(entries: CrashEntry[], match: (e: CrashEntry) => boolean) {
  const at = entries.findIndex(match);
  entries.splice(at < 0 ? 0 : at, 1);
}

/**
 * Rust panics and renderer deaths are capped at their shares, so an entry over
 * the total cap is always a JavaScript crash, and the oldest of those goes.
 */
function trimToRetention(entries: CrashEntry[]) {
  const isRust = (e: CrashEntry) => e.source === 'rust-panic';
  const isRenderer = (e: CrashEntry) => e.source === 'webview-renderer';
  while (entries.filter(isRust).length > MAX_RUST_ENTRIES) removeOldest(entries, isRust);
  while (entries.filter(isRenderer).length > MAX_RENDERER_ENTRIES) {
    removeOldest(entries, isRenderer);
  }
  while (entries.length > MAX_ENTRIES) {
    removeOldest(entries, (e) => !isRust(e) && !isRenderer(e));
  }
}

type NewCrash = Omit<CrashEntry, 'ts' | 'screen'> & { screen?: string | undefined };

function stamp(entry: NewCrash): CrashEntry {
  return {
    ts: Date.now(),
    screen: entry.screen ?? currentScreen,
    source: entry.source,
    message: entry.message,
    stack: entry.stack,
    fatal: entry.fatal,
  };
}

/**
 * The cache moves only once the write has succeeded, so a failed batch can be
 * retried whole. `inFatalFile` says the batch was also written to the fatal
 * file, which is then deleted once the batch is stored.
 */
function appendEntries(added: CrashEntry[], inFatalFile = false): Promise<void> {
  return enqueue(async () => {
    const stored = await load();
    // A fatal this process wrote to its file may already be in from that file.
    const entries = [...stored, ...added.filter((a) => !stored.some((e) => sameEntry(e, a)))];
    trimToRetention(entries);
    await AsyncStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entries));
    cache = entries;
    if (inFatalFile) await deleteFatalCrashes();
  });
}

/**
 * Append a batch and resolve once it is stored. Rejects when it could not be
 * read or written, so a caller holding the only other copy can keep it.
 */
export function recordCrashes(entries: NewCrash[]): Promise<void> {
  return appendEntries(entries.map(stamp));
}

/**
 * Fire-and-forget. A crash handler must never throw. A fatal is also written
 * synchronously, so it survives the process ending before the queued write.
 */
export function recordCrash(entry: NewCrash) {
  try {
    const stamped = stamp(entry);
    let inFatalFile = false;
    if (stamped.fatal) {
      try {
        writeFatalCrash(stamped);
        inFatalFile = true;
      } catch {
        // The queued write below is the remaining chance to keep it.
      }
    }
    appendEntries([stamped], inFatalFile).catch(() => {});
  } catch {
    // Recording the crash must never mask the crash itself.
  }
}

export async function getCrashLog(): Promise<CrashEntry[]> {
  const entries = await enqueue(load).catch(() => [] as CrashEntry[]);
  return [...entries].reverse();
}

/**
 * Empty the log, in memory and stored. A message or a stack can carry a ride's
 * name or an activity id, so the wipe takes it with the library.
 */
export async function clearCrashLog(): Promise<void> {
  await enqueue(async () => {
    cache = [];
    await AsyncStorage.removeItem(CRASH_LOG_KEY).catch(() => {});
    await deleteFatalCrashes();
  });
}

/** The entries, newest first as given, under the header that names the build sending them. */
export function formatCrashLog(entries: CrashEntry[]): string {
  if (!entries.length) return '';
  const body = entries
    .map((e) => {
      const when = new Date(e.ts).toISOString();
      const tags = `${e.source}${e.fatal ? ', fatal' : ''}`;
      const head = `[${when}] (${tags}) screen=${e.screen ?? 'unknown'}`;
      return e.stack ? `${head}\n${e.message}\n${e.stack}` : `${head}\n${e.message}`;
    })
    .join('\n\n---\n\n');
  return `${crashLogHeader()}\n\n---\n\n${body}`;
}

// Chains the existing global handler so RN's own reporting still runs.
export function installGlobalCrashHandler() {
  const g = global as unknown as {
    __veloqCrashHandlerInstalled?: boolean;
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  if (g.__veloqCrashHandlerInstalled) return;
  g.__veloqCrashHandlerInstalled = true;

  const errorUtils = g.ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils?.setGlobalHandler) return;

  const prev = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    try {
      const err = error as { message?: unknown; stack?: unknown } | null;
      recordCrash({
        source: 'js-global',
        message: err?.message ? String(err.message) : String(error),
        stack: err?.stack ? String(err.stack) : undefined,
        fatal: !!isFatal,
      });
    } catch {
      // Recording the crash must never mask the crash itself.
    }
    prev?.(error, isFatal);
  });
}
