import React from 'react';
import { router } from 'expo-router';

import { RestorePromptSheet } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The one-time offer to restore on an empty signed-in library, a sheet route pushed by the auth gate. */

function RestorePromptSheetContent() {
  return <RestorePromptSheet onClose={() => router.back()} />;
}

export default withScreenBoundary(RestorePromptSheetContent, 'Restore Prompt');
