import { Linking } from 'react-native';

import { i18n } from '@/i18n';
import { debug } from '@/shared/debug/debug';
import { confirmAction } from '@/shared/ui/dialog';

const log = debug.create('Permissions');

/** Opens Veloq's own page in system settings, the one place a blocked permission changes. */
export function openAppSettings(): void {
  Linking.openSettings().catch((e: unknown) => log.warn('could not open the app settings', e));
}

/**
 * The notice for a control with no room to draw one, such as a map's locate
 * button: the tap raised no system dialog, so it says what is off and offers
 * the settings page rather than doing nothing.
 */
export function alertPermissionBlocked(title: string, reason: string): void {
  confirmAction({
    title,
    message: reason,
    confirmLabel: i18n.t('common.openSettings'),
    cancelLabel: i18n.t('common.cancel'),
    onConfirm: openAppSettings,
  });
}
