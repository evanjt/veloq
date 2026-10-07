import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { getEngine } from '@/shared/native/engine';

export function useRouteReference(
  id: string | undefined,
  representativeId: string | undefined,
  t: TFunction
) {
  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id || activityId === representativeId) return;
      Alert.alert(t('routes.setAsReference'), t('routes.setAsReferenceConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            const engine = getEngine();
            if (!engine) return;
            engine.setRouteRepresentative(id, activityId);
          },
        },
      ]);
    },
    [id, representativeId, t]
  );

  return {
    effectiveRepresentativeId: representativeId,
    handleSetAsReference,
  };
}
