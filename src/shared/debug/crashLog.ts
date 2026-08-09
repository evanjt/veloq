// On-device crash sink. Stores the last few crashes in AsyncStorage so users
// can share them, since the stores surface no crash reports for this app.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_LOG_KEY = 'veloq-crash-log';
const MAX_ENTRIES = 20;

export type CrashSource = 'js-global' | 'react-boundary' | 'rust-panic';

export interface CrashEntry {
  ts: number;
  source: CrashSource;
  message: string;
  stack?: string;
  screen?: string;
  fatal?: boolean;
}

let currentScreen = 'unknown';
let cache: CrashEntry[] | null = null;

export function setCrashScreen(screen: string) {
  if (screen) currentScreen = screen;
}

async function load(): Promise<CrashEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(CRASH_LOG_KEY);
    cache = raw ? (JSON.parse(raw) as CrashEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

// Fire-and-forget. A crash handler must never throw.
export function recordCrash(entry: Omit<CrashEntry, 'ts' | 'screen'> & { screen?: string }) {
  const full: CrashEntry = {
    ts: Date.now(),
    screen: entry.screen ?? currentScreen,
    source: entry.source,
    message: entry.message,
    stack: entry.stack,
    fatal: entry.fatal,
  };
  load()
    .then((entries) => {
      entries.push(full);
      while (entries.length > MAX_ENTRIES) entries.shift();
      cache = entries;
      AsyncStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entries)).catch(() => {});
    })
    .catch(() => {});
}

export async function getCrashLog(): Promise<CrashEntry[]> {
  const entries = await load();
  return [...entries].reverse();
}

export async function clearCrashLog(): Promise<void> {
  cache = [];
  try {
    await AsyncStorage.removeItem(CRASH_LOG_KEY);
  } catch {}
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
    } catch {}
    prev?.(error, isFatal);
  });
}
