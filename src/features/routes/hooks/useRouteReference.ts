import { useCallback, useRef } from 'react';
import type { TFunction } from 'i18next';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { routes } from 'veloqrs';

export function useRouteReference(
  id: string | undefined,
  representativeId: string | undefined,
  t: TFunction
) {
  // The engine refuses a change while another runs, so a tap in that window
  // is refused here rather than sent to fail.
  const changeInFlight = useRef(false);

  const runChange = useCallback(
    async (change: () => Promise<boolean> | undefined) => {
      if (changeInFlight.current) return;
      changeInFlight.current = true;
      let taken = false;
      try {
        taken = (await change()) ?? false;
      } catch {
        taken = false;
      } finally {
        changeInFlight.current = false;
      }
      if (!taken) {
        inform({
          title: t('routes.referenceFailedTitle'),
          message: t('routes.referenceFailedMessage'),
        });
      }
    },
    [t]
  );

  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id || changeInFlight.current) return;
      if (activityId === representativeId) {
        confirmAction({
          title: t('routes.resetReference'),
          message: t('routes.resetReferenceConfirm'),
          confirmLabel: t('common.reset'),
          cancelLabel: t('common.cancel'),
          onConfirm: () => {
            void runChange(() => routes.resetRouteRepresentative(id));
          },
        });
        return;
      }
      confirmAction({
        title: t('routes.setAsReference'),
        message: t('routes.setAsReferenceConfirm'),
        confirmLabel: t('routes.setAsReference'),
        cancelLabel: t('common.cancel'),
        onConfirm: () => {
          void runChange(() => routes.setRouteRepresentative(id, activityId));
        },
      });
    },
    [id, representativeId, runChange, t]
  );

  return {
    effectiveRepresentativeId: representativeId,
    handleSetAsReference,
  };
}
