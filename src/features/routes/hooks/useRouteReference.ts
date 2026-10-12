import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { getEngine } from '@/shared/native/engine';
import { confirmAction } from '@/shared/ui/dialog';

export function useRouteReference(
  id: string | undefined,
  representativeId: string | undefined,
  t: TFunction
) {
  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id) return;
      if (activityId === representativeId) {
        confirmAction({
          title: t('routes.resetReference'),
          message: t('routes.resetReferenceConfirm'),
          confirmLabel: t('common.reset'),
          cancelLabel: t('common.cancel'),
          onConfirm: () => {
            const engine = getEngine();
            if (!engine) return;
            void engine.resetRouteRepresentative(id);
          },
        });
        return;
      }
      confirmAction({
        title: t('routes.setAsReference'),
        message: t('routes.setAsReferenceConfirm'),
        confirmLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: () => {
          const engine = getEngine();
          if (!engine) return;
          void engine.setRouteRepresentative(id, activityId);
        },
      });
    },
    [id, representativeId, t]
  );

  return {
    effectiveRepresentativeId: representativeId,
    handleSetAsReference,
  };
}
