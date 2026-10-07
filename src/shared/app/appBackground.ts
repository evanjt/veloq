import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import { reportFeedClosed } from '@/shared/native/feedSeen';
import { flushBasemapSidecars } from '@/features/maps/lib/basemapFlush';
import { onAppBackground } from '@/features/settings/lib/autobackup';

/**
 * What the app does when it goes to the background. The root layout calls this
 * from its AppState listener.
 */
export function handleAppBackground(): void {
  // The engine rings the activities that arrive after this moment.
  reportFeedClosed();
  onAppBackground();
  // The last moment the process is reliably alive. Without this a tile
  // source under the store's flush cadence keeps no index, and the next
  // launch rebuilds it by walking the tree at mount.
  flushBasemapSidecars();
  // Refresh the home-screen widget with the latest data while we have the
  // engine warm. No-op until the native widget module is built in.
  updateWidgetSnapshot();
}
