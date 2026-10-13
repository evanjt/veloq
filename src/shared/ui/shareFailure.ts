/**
 * What the athlete is told when a share they started does not open. Both
 * platforms resolve the share promise when the sheet closes, whether a target
 * was chosen or not, so a rejection is a real failure and never a cancel.
 */

import type { TFunction } from 'i18next';

import { inform } from '@/shared/ui/dialog';

/** The device offers no share sheet at all, which is not the same as one that failed. */
export class SharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device');
    this.name = 'SharingUnavailableError';
  }
}

export function informShareFailed(error: unknown, t: TFunction): void {
  inform({
    title: t('export.shareFailedTitle'),
    message: t(
      error instanceof SharingUnavailableError ? 'export.shareUnavailable' : 'export.shareFailed'
    ),
  });
}
