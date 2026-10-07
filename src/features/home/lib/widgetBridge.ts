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
import { debug } from '@/shared/debug/debug';

import {
  gatherWidgetSnapshot,
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
  try {
    // i18n.t is typed to a finite key union; the widget passes plain keys at runtime.
    const t = i18n.t as unknown as (key: string) => string;
    const snapshot = gatherWidgetSnapshot({
      locale: i18n.language,
      isMetric: getIsMetric(),
      formAsPercent: formAsPercent(),
      now,
      translate: (key) => t(key),
    });
    if (snapshot) writeWidgetSnapshot(snapshot);
  } catch (e) {
    log.warn('updateWidgetSnapshot failed:', e);
  }
}

/**
 * Delete the snapshot and the launcher shortcuts, then redraw the widgets.
 *
 * The snapshot carries the latest ride with its route outline, form, HRV and
 * resting heart rate, and a refresh that cannot read the engine leaves the last
 * one standing, so the wipe deletes it rather than waiting for a refresh.
 */
export function clearWidgetSnapshot(): void {
  if (!VeloqWidget) return;
  try {
    VeloqWidget.clearSnapshot();
    VeloqWidget.publishRecordShortcuts?.([]);
    VeloqWidget.reloadWidgets();
  } catch (e) {
    log.warn('clearWidgetSnapshot failed:', e);
  }
}
