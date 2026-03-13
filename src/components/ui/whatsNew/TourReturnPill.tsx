import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, shadows } from '@/theme';
import { useWhatsNewStore } from '@/providers';
import { TAB_BAR_HEIGHT, GRADIENT_HEIGHT } from '../BottomTabBar';
import { WHATS_NEW_SLIDES } from './slides';

export function TourReturnPill() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const tourState = useWhatsNewStore((s) => s.tourState);
  const resumeTour = useWhatsNewStore((s) => s.resumeTour);
  const endTour = useWhatsNewStore((s) => s.endTour);
  const markSeen = useWhatsNewStore((s) => s.markSeen);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);

  if (!tourState || !tourState.exploring) return null;

  const currentVersion = Constants.expoConfig?.version ?? '';
  const isAutoTriggered = lastSeenVersion !== currentVersion;

  const handleClose = () => {
    if (isAutoTriggered && WHATS_NEW_SLIDES[currentVersion]) {
      markSeen(currentVersion);
    }
    endTour();
  };

  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const bottomOffset = TAB_BAR_HEIGHT + GRADIENT_HEIGHT + insets.bottom + spacing.sm;

  return (
    <Animated.View
      style={[styles.container, { bottom: bottomOffset }]}
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(200)}
    >
      <View style={[styles.pillWrapper, { backgroundColor: bgColor }, shadows.elevated]}>
        {tourState.tip && (
          <Text
            style={[
              styles.tipText,
              { color: isDark ? darkColors.textPrimary : colors.textPrimary },
            ]}
          >
            {t(tourState.tip as never)}
          </Text>
        )}
        <View style={styles.buttonRow}>
          <Pressable style={styles.backButton} onPress={resumeTour} hitSlop={8}>
            <MaterialCommunityIcons name="arrow-left" size={18} color={primaryColor} />
            <Text style={[styles.backText, { color: primaryColor }]}>
              {t('whatsNew.backToTour')}
            </Text>
          </Pressable>

          <View
            style={[
              styles.divider,
              { backgroundColor: isDark ? darkColors.border : colors.border },
            ]}
          />

          <Pressable style={styles.closeButton} onPress={handleClose} hitSlop={8}>
            <Text style={[styles.closeText, { color: mutedColor }]}>{t('whatsNew.closeTour')}</Text>
            <MaterialCommunityIcons name="close" size={16} color={mutedColor} />
          </Pressable>
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
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  backText: {
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: spacing.xs,
  },
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
