import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import { flushBasemapSidecars } from '@/features/maps/lib/basemapFlush';
import { onAppBackground } from '@/features/settings/lib/autobackup';
import { quietEngineForSuspension } from '@/shared/native/engineSuspension';

/**
 * What the app does when it goes to the background. The root layout calls this
 * from its AppState listener.
 */
export function handleAppBackground(): void {
  const backup = onAppBackground();
  // The last moment the process is reliably alive. Without this a tile
  // source under the store's flush cadence keeps no index, and the next
  // launch rebuilds it by walking the tree at mount.
  flushBasemapSidecars();
  // Refresh the home-screen widget with the latest data while we have the
  // engine warm. No-op until the native widget module is built in.
  updateWidgetSnapshot();
  // Last, since the engine refuses writes once it has run. The backup is
  // still running and is given its time first.
  void quietEngineForSuspension(backup);
}
