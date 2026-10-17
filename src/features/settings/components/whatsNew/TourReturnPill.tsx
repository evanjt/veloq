import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Animated from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  motionPresets,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { Button, useBottomClearance } from '@/shared/ui';

export function TourReturnPill() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  // Floats absolute, so a safe area around it does not lift it by its padding.
  const bottomClearance = useBottomClearance({ insetTaken: false });
  const tourState = useWhatsNewStore((s) => s.tourState);
  const resumeTour = useWhatsNewStore((s) => s.resumeTour);
  const dismissTour = useWhatsNewStore((s) => s.dismissTour);

  if (!tourState || !tourState.exploring) return null;

  const currentVersion = Constants.expoConfig?.version ?? '';

  const handleClose = () => {
    dismissTour(currentVersion);
  };

  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const bottomOffset = bottomClearance + spacing.sm;

  return (
    <Animated.View style={[styles.container, { bottom: bottomOffset }]} {...motionPresets.pill}>
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
            icon={
              <MaterialCommunityIcons name="arrow-left" size={iconSize.md} color={primaryColor} />
            }
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
            icon={<MaterialCommunityIcons name="close" size={iconSize.sm} color={mutedColor} />}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  pillWrapper: {
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  tipText: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: 18,
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
