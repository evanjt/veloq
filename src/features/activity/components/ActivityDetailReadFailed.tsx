import React from 'react';

import { ErrorState } from '@/shared/ui';

interface ActivityDetailReadFailedProps {
  error: unknown;
  onRetry: () => void;
}

/**
 * Stands in for the Routes and Sections tabs when the detail bundle read threw,
 * so a failed read is not drawn as an activity that matched nothing.
 */
export function ActivityDetailReadFailed({ error, onRetry }: ActivityDetailReadFailedProps) {
  return <ErrorState error={error} fallbackKey="activityDetail.failedToLoad" onRetry={onRetry} />;
}
