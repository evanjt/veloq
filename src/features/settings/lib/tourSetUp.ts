import { isAutoBackupEnabled } from './autobackup';
import type { SetupSlide } from './tourOffer';
import { useNotificationPreferences } from '../stores/NotificationPreferencesStore';

/**
 * What Settings already has on among the tour's setup slides, read when a tour
 * closes so a slide swiped past for something already on is not offered again.
 */
export function setUpInSettings(): SetupSlide[] {
  const setUp: SetupSlide[] = [];
  if (useNotificationPreferences.getState().enabled) setUp.push('notifications');
  if (isAutoBackupEnabled()) setUp.push('backup');
  return setUp;
}
