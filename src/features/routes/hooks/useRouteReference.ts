import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { getRouteEngine } from '@/shared/native/routeEngine';

export function useRouteReference(
  id: string | undefined,
  representativeId: string | undefined,
  t: TFunction
) {
  // Local override for immediate UI feedback after setting a new reference
  // (useGroupDetail doesn't subscribe to engine events, so engineGroup.representativeId is stale)
  const [overrideRepresentativeId, setOverrideRepresentativeId] = useState<string | null>(null);
  const effectiveRepresentativeId = overrideRepresentativeId ?? representativeId;

  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id || activityId === effectiveRepresentativeId) return;
      Alert.alert(t('routes.setAsReference'), t('routes.setAsReferenceConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            const engine = getRouteEngine();
            if (!engine) return;
            const success = engine.setRouteRepresentative(id, activityId);
            if (success) {
              setOverrideRepresentativeId(activityId);
            }
          },
        },
      ]);
    },
    [id, effectiveRepresentativeId, t]
  );

  return {
    overrideRepresentativeId,
    setOverrideRepresentativeId,
    effectiveRepresentativeId,
    handleSetAsReference,
  };
}
