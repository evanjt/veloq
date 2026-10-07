import * as FileSystem from 'expo-file-system/legacy';

import { useEngineStatus } from '@/features/routes';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';
import { engineErrorTag } from '@/shared/native/engineError';

import { excludeSetAsideCopies, recoverPanicLog } from './databaseSidecars';

export function clearQuarantineReport(): void {
  useEngineStatus.getState().setQuarantineReport(null);
}

/**
 * Read what the open just salvaged, and keep every copy of the library set
 * aside out of the device backup. Called after every foreground open, which is
 * the only place the engine quarantines and comes after the App Group move sets
 * a library aside, so a copy is marked on the open that made it and one an
 * earlier build left is marked on the next. Documents is read too, because
 * every build before the App Group move quarantined there and the move takes
 * only the database.
 */
export function captureQuarantineReport(): void {
  try {
    const report = getEngine()?.takeQuarantineReport();
    if (report) useEngineStatus.getState().setQuarantineReport(report);
  } catch (error) {
    // The copies set aside below are still marked; only the counts are lost.
    console.warn('[Quarantine] Could not read the report:', engineErrorTag(error) ?? error);
  }
  const documents = FileSystem.documentDirectory?.replace(/^file:\/\//, '');
  const beside = new Set([getRouteDbPath(), documents ? `${documents}routes.db` : null]);
  for (const dbPath of beside) {
    if (dbPath) void excludeSetAsideCopies(dbPath);
    if (dbPath) void recoverPanicLog(dbPath);
  }
}
