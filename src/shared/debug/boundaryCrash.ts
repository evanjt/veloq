import type React from 'react';

import { recordCrash } from './crashLog';

/**
 * Record an error a React boundary caught.
 *
 * One helper for all four boundaries so they agree on the shape. The three
 * below the global one are not fatal: the app is still running behind their
 * fallback. They used to log to the console and nothing else, which release
 * strips, so a crash caught below the global boundary left no record at all,
 * and the stores surface no crash reports for this app.
 *
 * Never throws. A crash handler that throws replaces the crash it was meant to
 * record.
 */
export function recordBoundaryCrash(
  error: Error,
  errorInfo: React.ErrorInfo | undefined,
  options: { fatal: boolean; screen?: string }
): void {
  try {
    recordCrash({
      source: 'react-boundary',
      message: error?.message ? String(error.message) : String(error),
      stack: error?.stack ? String(error.stack) : errorInfo?.componentStack || undefined,
      fatal: options.fatal,
      screen: options.screen,
    });
  } catch {
    // Recording the crash must never mask the crash itself.
  }
}
