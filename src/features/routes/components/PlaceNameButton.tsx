/**
 * The button beside a route or section name that asks for a name from the
 * places it starts and ends in. The detail read decides whether it is shown;
 * this draws it and runs the lookup.
 */

import React from 'react';
import {} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PlaceNameKind } from 'veloqrs';
import { IconButton, Spinner } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { colors, colorWithOpacity, iconSize } from '@/theme';
import { usePlaceNameLookup } from '../hooks/usePlaceNameLookup';

export interface PlaceNameButtonProps {
  kind: PlaceNameKind;
  itemId: string;
  testID: string;
}

export function PlaceNameButton({ kind, itemId, testID }: PlaceNameButtonProps) {
  const { t } = useTranslation();
  const { pending, request } = usePlaceNameLookup(kind, itemId);

  return (
    <IconButton
      testID={testID}
      accessibilityLabel={t('routes.placeNameButton')}
      accessibilityState={{ busy: pending }}
      disabled={pending}
      onPress={request}
    >
      {pending ? (
        <Spinner inControl color={colors.textOnFill} />
      ) : (
        <Icon
          name="map-marker-outline"
          size={iconSize.md}
          color={colorWithOpacity(colors.textOnFill, 0.8)}
        />
      )}
    </IconButton>
  );
}
