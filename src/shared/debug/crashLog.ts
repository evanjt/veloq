// On-device crash sink. Stores the last few crashes in AsyncStorage so users
// can share them, since the stores surface no crash reports for this app.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_LOG_KEY = 'veloq-crash-log';
const MAX_ENTRIES = 20;
// Rust panics arrive in bulk from a file, so they hold a bounded share of the
// log; JavaScript crashes keep the rest and are never displaced by them.
const MAX_RUST_ENTRIES = 10;

export type CrashSource = 'js-global' | 'react-boundary' | 'rust-panic';

export interface CrashEntry {
  ts: number;
  source: CrashSource;
  message: string;
  stack?: string | undefined;
  screen?: string;
  fatal?: boolean | undefined;
}

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

/** Rejects when storage cannot be read, and caches nothing then, so a failed read is never written over. */
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
  cache = parsed;
  return cache;
}

function removeOldest(entries: CrashEntry[], match: (e: CrashEntry) => boolean) {
  const at = entries.findIndex(match);
  entries.splice(at < 0 ? 0 : at, 1);
}

/**
 * Rust panics are capped at their share, so an entry over the total cap is
 * always a JavaScript crash, and the oldest of those goes.
 */
function trimToRetention(entries: CrashEntry[]) {
  const isRust = (e: CrashEntry) => e.source === 'rust-panic';
  while (entries.filter(isRust).length > MAX_RUST_ENTRIES) removeOldest(entries, isRust);
  while (entries.length > MAX_ENTRIES) removeOldest(entries, (e) => !isRust(e));
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

/** The cache moves only once the write has succeeded, so a failed batch can be retried whole. */
function appendEntries(added: CrashEntry[]): Promise<void> {
  return enqueue(async () => {
    const entries = [...(await load()), ...added];
    trimToRetention(entries);
    await AsyncStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entries));
    cache = entries;
  });
}

/**
 * Append a batch and resolve once it is stored. Rejects when it could not be
 * read or written, so a caller holding the only other copy can keep it.
 */
export function recordCrashes(entries: NewCrash[]): Promise<void> {
  return appendEntries(entries.map(stamp));
}

// Fire-and-forget. A crash handler must never throw.
export function recordCrash(entry: NewCrash) {
  try {
    appendEntries([stamp(entry)]).catch(() => {});
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
  });
}

export function formatCrashLog(entries: CrashEntry[]): string {
  if (!entries.length) return '';
  return entries
    .map((e) => {
      const when = new Date(e.ts).toISOString();
      const tags = `${e.source}${e.fatal ? ', fatal' : ''}`;
      const head = `[${when}] (${tags}) screen=${e.screen ?? 'unknown'}`;
      return e.stack ? `${head}\n${e.message}\n${e.stack}` : `${head}\n${e.message}`;
    })
    .join('\n\n---\n\n');
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
