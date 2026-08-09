/**
 * Widget bridge: the JS side that pushes a snapshot to the native widget process.
 *
 * The native module `VeloqWidget` (iOS App Group write + WidgetCenter reload, Android
 * file write + AppWidgetManager update) does not exist yet, so every entry point here
 * NO-OPS until it is installed. This lets the data pipeline (gather → write → reload)
 * be wired into the app's lifecycle hooks now and "just work" once the native target
 * lands. `requireOptionalNativeModule` returns null when the module is absent.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { i18n } from '@/i18n';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { debug } from '@/shared/debug/debug';

import { gatherWidgetSnapshot, type WidgetSnapshot } from './widgetSnapshot';

const log = debug.create('Widget');

interface VeloqWidgetModule {
  writeSnapshot(json: string): void;
  reloadWidgets(): void;
}

const VeloqWidget = requireOptionalNativeModule<VeloqWidgetModule>('VeloqWidget');

/** True once the native widget module is built into the app. */
export function isWidgetBridgeAvailable(): boolean {
  return VeloqWidget != null;
}

/** Serialize and hand a prepared snapshot to the native widget, then trigger a redraw. */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): void {
  if (!VeloqWidget) return;
  try {
    VeloqWidget.writeSnapshot(JSON.stringify(snapshot));
    VeloqWidget.reloadWidgets();
  } catch (e) {
    log.warn('writeWidgetSnapshot failed:', e);
  }
}

/**
 * Gather fresh engine data and push it to the widget. Safe to call from anywhere
 * (app background, post-sync, post-save, the silent-push task). No-op when the native
 * module or the engine isn't ready, so callers don't need to guard.
 */
export function updateWidgetSnapshot(now?: Date): void {
  if (!VeloqWidget) return;
  try {
    // i18n.t is typed to a finite key union; the widget passes plain keys at runtime.
    const t = i18n.t as unknown as (key: string) => string;
    const snapshot = gatherWidgetSnapshot({
      locale: i18n.language,
      isMetric: getIsMetric(),
      now,
      translate: (key) => t(key),
    });
    if (snapshot) writeWidgetSnapshot(snapshot);
  } catch (e) {
    log.warn('updateWidgetSnapshot failed:', e);
  }
}
