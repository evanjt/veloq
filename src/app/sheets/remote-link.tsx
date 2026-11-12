import React from 'react';

import { RemoteLinkSheet } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The linked browsers and their connections, a sheet route opened from the Settings dot. */
function RemoteLinkSheetContent() {
  return <RemoteLinkSheet />;
}

export default withScreenBoundary(RemoteLinkSheetContent, 'Remote link');
