import * as Location from 'expo-location';

import { i18n } from '@/i18n';
import { alertPermissionBlocked } from './openAppSettings';
import { askPermission, type PermissionOutcome } from './outcome';

/**
 * Asks for foreground location from a control the athlete has just tapped. A
 * refusal given in the dialog needs nothing more; a tap that raised no dialog
 * says location is off and offers the settings page, rather than doing nothing.
 */
export async function askForegroundLocation(): Promise<PermissionOutcome> {
  const { outcome, prompted } = await askPermission(
    () => Location.getForegroundPermissionsAsync(),
    () => Location.requestForegroundPermissionsAsync()
  );
  if (outcome === 'blocked' && !prompted) {
    alertPermissionBlocked(
      i18n.t('permissionNotice.locationOffTitle'),
      i18n.t('permissionNotice.locationOff')
    );
  }
  return outcome;
}
