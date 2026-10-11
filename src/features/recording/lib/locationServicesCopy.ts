import type { TFunction } from 'i18next';

import { canTurnOnLocationServices } from '@/shared/app/permissions/locationServices';

/**
 * What a GPS sport says when the device's location switch is off. Android can
 * turn it on from the app, so the line says what is off and the action does
 * the rest; iOS cannot, so the line names where the switch is.
 */
export function locationServicesOffMessage(t: TFunction): string {
  return canTurnOnLocationServices()
    ? t('recording.gpsServicesOffAndroid')
    : t('recording.gpsServicesOffIos');
}
