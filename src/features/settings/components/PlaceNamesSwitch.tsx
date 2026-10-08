import React, { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import { getPlaceNamesEnabled, setPlaceNamesEnabled } from '@/shared/native/placeNames';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

export const NOMINATIM_POLICY_URL = 'https://operations.osmfoundation.org/policies/nominatim/';

/**
 * The notice that has to be read before a point leaves the device. Every
 * button closes the alert, so the policy button shows it again after the link
 * opens. Cancelling, or dismissing by the back gesture or a tap outside, is a
 * decline.
 */
function presentNotice(t: TFunction, onAccept: () => void): void {
  Alert.alert(
    t('settings.placeNames.noticeTitle'),
    t('settings.placeNames.noticeBody'),
    [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.placeNames.readPolicy'),
        onPress: () => {
          Linking.openURL(NOMINATIM_POLICY_URL);
          presentNotice(t, onAccept);
        },
      },
      { text: t('settings.placeNames.accept'), onPress: onAccept },
    ],
    { cancelable: true }
  );
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

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
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
      <View style={styles.row}>
        <MaterialCommunityIcons name="map-marker-outline" size={22} color={textSecondary} />
        <Text style={[styles.label, { color: textPrimary }]}>{t('settings.placeNames.title')}</Text>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          color={colors.primary}
          testID="settings-place-names-toggle"
        />
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    flex: 1,
  },
  hint: {
    ...typography.caption,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
