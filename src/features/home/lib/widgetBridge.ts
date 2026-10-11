/**
 * Widget bridge: the JS side that pushes a snapshot to the native widget process.
 *
 * The native module `VeloqWidget` is `modules/veloq-widget`: an App Group write and
 * a WidgetCenter reload on iOS, a `filesDir` write and an AppWidgetManager update on
 * Android. `requireOptionalNativeModule` returns null where it is absent, on web and
 * in tests, and every entry point here then does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { i18n } from '@/i18n';
import { formAsPercent } from '@/shared/app/FormPreferenceStore';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { runWhenIdle, type Cancel } from '@/shared/async/runWhenIdle';
import { debug } from '@/shared/debug/debug';
import type { TFunc } from '@/features/insights/light';

import {
  gatherWidgetSnapshot,
  showsDemoLibrary,
  showsSampleLibrary,
  type WidgetRecordShortcut,
  type WidgetSnapshotPayload,
} from './widgetSnapshot';

const log = debug.create('Widget');

interface VeloqWidgetModule {
  writeSnapshot(json: string): void;
  /** Delete the snapshot file, so the widgets draw their placeholder. */
  clearSnapshot(): void;
  reloadWidgets(): void;
  /** Android only: the recent sports as launcher shortcuts. Absent on iOS. */
  publishRecordShortcuts?(shortcuts: WidgetRecordShortcut[]): void;
}

const VeloqWidget = requireOptionalNativeModule<VeloqWidgetModule>('VeloqWidget');

export function writeWidgetSnapshot(snapshot: WidgetSnapshotPayload): void {
  if (!VeloqWidget) return;
  try {
    VeloqWidget.writeSnapshot(snapshot.json);
    VeloqWidget.reloadWidgets();
    // The launcher holds its own copy of the shortcut list, so it is pushed
    // rather than read from the file the widgets poll.
    VeloqWidget.publishRecordShortcuts?.(snapshot.launcherShortcuts);
  } catch (e) {
    log.warn('writeWidgetSnapshot failed:', e);
  }
}

/**
 * Gather fresh engine data and push it to the widget. Safe to call from anywhere
 * (app background, post-sync, post-save, the silent-push task). No-op when the native
 * module is absent or the database is not open, so callers don't need to guard and a
 * refresh that cannot read anything leaves the last good snapshot standing.
 */
export function updateWidgetSnapshot(now?: Date): void {
  if (!VeloqWidget) return;
  // This write reads the engine as it is now, so one still waiting would only
  // repeat it.
  cancelScheduledWrite();
  try {
    const snapshot = gatherCurrentSnapshot(now);
    if (snapshot) writeWidgetSnapshot(snapshot);
  } catch (e) {
    log.warn('updateWidgetSnapshot failed:', e);
  }
}

let scheduledWrite: Cancel | null = null;

/**
 * Refresh the widget once the JS thread is idle, for a caller in the foreground.
 *
 * The refresh reads the insights bundle, ranks it and composes the snapshot,
 * tens of milliseconds of engine work in one task, and the callers that ask for
 * it are the moments every screen is refreshing too. Asks that arrive before
 * the write runs share it, since it reads the engine as it is when it runs.
 * Nothing cancels it but a write that supersedes it: the caller may be gone by
 * then, and the home screen still wants the numbers.
 *
 * Backgrounding and the headless push task call `updateWidgetSnapshot` instead,
 * because the process may be frozen before the thread idles.
 */
export function scheduleWidgetSnapshot(): void {
  if (!VeloqWidget || scheduledWrite) return;
  scheduledWrite = runWhenIdle(() => {
    scheduledWrite = null;
    updateWidgetSnapshot();
  });
}

function cancelScheduledWrite(): void {
  scheduledWrite?.();
  scheduledWrite = null;
}

/**
 * Redraw the widgets where the numbers on them are the sample library's: at a
 * launch that finds nobody signed in, at a sign-out and on entering demo mode.
 * A signed-in athlete's widgets wait for their own sync, so this leaves them be.
 */
export function refreshSampleWidgets(): void {
  if (showsDemoLibrary()) updateWidgetSnapshot();
}

function gatherCurrentSnapshot(now?: Date): WidgetSnapshotPayload | null {
  // i18n.t is typed to a finite key union; the widget passes plain keys at runtime.
  // A phrase with slots keeps its `{{name}}` for the engine to fill, rather than resolving it empty.
  const t = i18n.t as unknown as (key: string, options: object) => string;
  return gatherWidgetSnapshot({
    locale: i18n.language,
    isMetric: getIsMetric(),
    formAsPercent: formAsPercent(),
    now,
    translate: (key) => t(key, { interpolation: { skipOnVariables: true } }),
    translateInsight: i18n.t as unknown as TFunc,
  });
}

/**
 * Replace the snapshot after a library wipe, and the launcher shortcuts, then
 * redraw the widgets.
 *
 * The snapshot carries the latest ride with its route outline, form, HRV and
 * resting heart rate, and a refresh that cannot read the engine leaves the last
 * one standing, so the wipe replaces it rather than waiting for a refresh. With
 * nobody signed in the replacement is the sample library, marked as one, so the
 * widgets draw numbers and not the prompt to open the app. When the sample
 * cannot be composed, or an account is signed in whose library is now empty,
 * the file is deleted and the widgets draw their placeholder.
 */
export function resetWidgetSnapshot(): void {
  if (!VeloqWidget) return;
  // A write asked for before the wipe would compose over the replacement.
  cancelScheduledWrite();
  try {
    if (showsSampleLibrary()) {
      const sample = gatherCurrentSnapshot();
      if (sample) {
        writeWidgetSnapshot(sample);
        return;
      }
    }
    VeloqWidget.clearSnapshot();
    VeloqWidget.publishRecordShortcuts?.([]);
    VeloqWidget.reloadWidgets();
  } catch (e) {
    log.warn('resetWidgetSnapshot failed:', e);
  }
}
