import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import { openExternal } from '@/shared/app/openExternal';
import { getPlaceNamesEnabled, setPlaceNamesEnabled } from '@/shared/native/placeNames';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { chooseAction } from '@/shared/ui/dialog';

export const NOMINATIM_POLICY_URL = 'https://operations.osmfoundation.org/policies/nominatim/';

/**
 * The notice that has to be read before a point leaves the device. Every
 * button closes the alert, so the policy button shows it again after the link
 * opens. Cancelling, or dismissing by the back gesture or a tap outside, is a
 * decline.
 */
function presentNotice(t: TFunction, onAccept: () => void): void {
  chooseAction({
    title: t('settings.placeNames.noticeTitle'),
    message: t('settings.placeNames.noticeBody'),
    cancelLabel: t('common.cancel'),
    actions: [
      {
        label: t('settings.placeNames.readPolicy'),
        onPress: () => {
          void openExternal(NOMINATIM_POLICY_URL);
          presentNotice(t, onAccept);
        },
      },
      { label: t('settings.placeNames.accept'), onPress: onAccept },
    ],
  });
}

/**
 * The switch that lets the engine send the start and end point of each new
 * route or section to the geocoder for a place name. The engine holds the
 * setting; this component keeps only what it last read, so the switch never
 * shows a state the engine does not have.
 */
export function PlaceNamesSwitch() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [enabled, setEnabled] = useState(getPlaceNamesEnabled);

  const turnOn = useCallback(() => {
    setPlaceNamesEnabled(true);
    setEnabled(getPlaceNamesEnabled());
  }, []);

  const showNotice = useCallback(() => presentNotice(t, turnOn), [t, turnOn]);

  const handleToggle = useCallback(
    (value: boolean) => {
      if (value) {
        showNotice();
        return;
      }
      setPlaceNamesEnabled(false);
      setEnabled(false);
    },
    [showNotice]
  );

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? darkColors.surface : colors.surface,
          borderColor: isDark ? darkColors.border : colors.border,
        },
      ]}
    >
      <SwitchRow
        icon="map-marker-outline"
        title={t('settings.placeNames.title')}
        value={enabled}
        onValueChange={handleToggle}
        testID="settings-place-names-toggle"
      />
      <Text style={[styles.hint, { color: textSecondary }]}>
        {t('settings.placeNames.attribution')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  hint: {
    ...typography.caption,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
