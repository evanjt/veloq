/**
 * The show or hide control on a secret field, so every one reads the same to a
 * screen reader: a button whose label names what pressing it does, and whose
 * selected state says the secret is on screen.
 */

import type { TFunction } from 'i18next';

export interface SecretReveal {
  icon: 'eye-outline' | 'eye-off-outline';
  accessibilityLabel: string;
  accessibilityState: { selected: boolean };
}

export function secretReveal(revealed: boolean, t: TFunction): SecretReveal {
  return {
    icon: revealed ? 'eye-off-outline' : 'eye-outline',
    accessibilityLabel: revealed ? t('common.hidePassword') : t('common.showPassword'),
    accessibilityState: { selected: revealed },
  };
}
