/**
 * Global banner shown when the Rust engine fails to initialise.
 * Non-dismissible: the engine is required for the activity library, routes,
 * sections, and fitness data.
 *
 * The line and the actions are the engine's own reason, read through
 * `engineInitReasonLine` and `engineRecoveryActions`, the same ones a screen
 * that cannot read the library shows in its place. The general line stays as
 * the fallback for a reason a shipped build has no string for, which is what
 * an engine newer than the bundle produces.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { engineInitReasonLine, engineRecoveryActions } from '@/shared/app/engineInitReason';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';

export function EngineInitBanner() {
  const { t } = useTranslation();
  const initFailed = useEngineStatus((s) => s.initFailed);
  const initFailureReason = useEngineStatus((s) => s.initFailureReason);
  const storageShortfall = useEngineStatus((s) => s.storageShortfall);
  // Re-runs the root layout's full init effect (open, identity check,
  // post-init setup), not just a bare re-open.
  const requestRetry = useEngineStatus((s) => s.requestRetry);

  if (!initFailed) {
    return null;
  }

  return (
    <NoticeBanner
      slot="engineInit"
      tone="error"
      icon="alert-circle-outline"
      title={engineInitReasonLine(initFailureReason, storageShortfall, t)}
      actions={engineRecoveryActions(initFailureReason, t, requestRetry)}
      testID="engine-init-banner"
    />
  );
}
