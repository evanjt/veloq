import React from 'react';

import { ErrorState } from '@/shared/ui';

interface ActivityDetailReadFailedProps {
  error: unknown;
  onRetry: () => void;
  /** `screen` replaces a whole tab; `inline` sits under the card's pinned text. */
  variant?: 'screen' | 'inline';
  testID?: string;
}

/**
 * Says that the detail bundle read threw, with a retry, so a failed read is
 * not drawn as an activity that matched nothing. The Routes and Sections tabs
 * take it in place of their pages; the pinned text takes it inline on every
 * activity, with or without a track.
 */
export function ActivityDetailReadFailed({
  error,
  onRetry,
  variant = 'screen',
  testID,
}: ActivityDetailReadFailedProps) {
  return (
    <ErrorState
      error={error}
      fallbackKey="activityDetail.failedToLoad"
      onRetry={onRetry}
      variant={variant}
      {...(testID ? { testID } : {})}
    />
  );
}
