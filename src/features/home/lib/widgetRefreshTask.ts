/**
 * Periodic widget refresh.
 *
 * The event-driven writes (foreground, pull-to-refresh, sync completion, silent
 * push) are what keep the widget honest. This task is the floor under them: it
 * pulls the trailing wellness window and rewrites the snapshot while the app is
 * not running at all.
 *
 * The interval is a request, not a schedule. iOS BGTaskScheduler and Android
 * WorkManager both decide the real cadence from usage and battery state, so
 * treat six hours as the best case rather than a guarantee, and never rely on
 * this task for correctness.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { refreshWellnessAndWait } from '@/shared/native/refreshWellness';

import { updateWidgetSnapshot } from './widgetBridge';

export const WIDGET_REFRESH_TASK = 'veloq-widget-refresh';

/** Minutes between refresh attempts, as requested of the OS scheduler. */
export const WIDGET_REFRESH_INTERVAL_MINUTES = 6 * 60;

TaskManager.defineTask(WIDGET_REFRESH_TASK, async () => {
  try {
    await refreshWellnessAndWait();
    updateWidgetSnapshot();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the periodic refresh. Safe to call on every launch. */
export async function registerWidgetRefreshTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(WIDGET_REFRESH_TASK);
    if (isRegistered) return;
    await BackgroundTask.registerTaskAsync(WIDGET_REFRESH_TASK, {
      minimumInterval: WIDGET_REFRESH_INTERVAL_MINUTES,
    });
  } catch (e) {
    if (__DEV__) console.warn('[widgetRefresh] registration failed:', e);
  }
}
