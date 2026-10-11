import React from 'react';

import { RestorePromptSheet } from '@/features/settings';
import { goBack } from '@/shared/app/navigation';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The one-time offer to restore on an empty signed-in library, a sheet route pushed by the auth gate. */

function RestorePromptSheetContent() {
  return <RestorePromptSheet onClose={goBack} />;
}

export default withScreenBoundary(RestorePromptSheetContent, 'Restore Prompt');
