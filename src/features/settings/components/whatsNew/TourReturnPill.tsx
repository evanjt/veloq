import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, motionPresets, shadows, spacing, typography } from '@/theme';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { Button } from '@/shared/ui';

export function TourReturnPill() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const tourState = useWhatsNewStore((s) => s.tourState);
  const resumeTour = useWhatsNewStore((s) => s.resumeTour);
  const dismissTour = useWhatsNewStore((s) => s.dismissTour);

  if (!tourState || !tourState.exploring) return null;

  const currentVersion = Constants.expoConfig?.version ?? '';

  const handleClose = () => {
    dismissTour(currentVersion);
  };

  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;

  return (
    <Animated.View style={styles.container} {...motionPresets.pill}>
      <View style={[styles.pillWrapper, { backgroundColor: bgColor }, shadows.elevated]}>
        {tourState.tip ? (
          <Text
            style={[
              styles.tipText,
              { color: isDark ? darkColors.textPrimary : colors.textPrimary },
            ]}
          >
            {t(tourState.tip as never)}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          <Button
            label={t('whatsNew.backToTour')}
            onPress={resumeTour}
            variant="ghost"
            size="sm"
            icon="arrow-left"
          />

          <View
            style={[
              styles.divider,
              { backgroundColor: isDark ? darkColors.border : colors.border },
            ]}
          />

          <Button
            label={t('whatsNew.closeTour')}
            onPress={handleClose}
            variant="ghost"
            size="sm"
            icon="close"
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  pillWrapper: {
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  tipText: {
    ...typography.bodyCompact,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: spacing.xs,
  },
});
