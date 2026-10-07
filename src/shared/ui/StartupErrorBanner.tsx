/**
 * Banner for a launch where an initialiser rejected.
 *
 * It names the part of the app that did not load, from a translated line per
 * area, and never the initialiser's own message, which is English and in the
 * engine's vocabulary. The work has finished, so nothing spins. The English
 * defaults cover the launch where the language initialiser is the one that
 * failed and the translator has no bundle to read.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useBannerPadsStatusBar } from '@/shared/app/TopSafeAreaContext';
import { amberBanner, spacing, typography } from '@/theme';
import { Button } from './Button';

export type StartupArea =
  | 'language'
  | 'preferences'
  | 'heartRateZones'
  | 'routes'
  | 'maps'
  | 'notifications'
  | 'recording'
  | 'insights'
  | 'other';

const AREA_DEFAULT: Record<StartupArea, string> = {
  language: 'language',
  preferences: 'preferences',
  heartRateZones: 'heart rate zones',
  routes: 'route settings',
  maps: 'map settings',
  notifications: 'notifications',
  recording: 'recording settings',
  insights: 'insights',
  other: 'other settings',
};

const AREA_KEY = {
  language: 'emptyState.startupError.area.language',
  preferences: 'emptyState.startupError.area.preferences',
  heartRateZones: 'emptyState.startupError.area.heartRateZones',
  routes: 'emptyState.startupError.area.routes',
  maps: 'emptyState.startupError.area.maps',
  notifications: 'emptyState.startupError.area.notifications',
  recording: 'emptyState.startupError.area.recording',
  insights: 'emptyState.startupError.area.insights',
  other: 'emptyState.startupError.area.other',
} as const satisfies Record<StartupArea, string>;

interface StartupErrorBannerProps {
  areas: readonly StartupArea[];
  onDismiss: () => void;
}

export function StartupErrorBanner({ areas, onDismiss }: StartupErrorBannerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const padsStatusBar = useBannerPadsStatusBar('startupError');
  const { isDark } = useTheme();
  const palette = isDark ? amberBanner.dark : amberBanner.light;
  const named = areas
    .map((area) => t(AREA_KEY[area], { defaultValue: AREA_DEFAULT[area] }))
    .join(', ');

  return (
    <View
      testID="startup-error-banner"
      style={[
        styles.container,
        {
          backgroundColor: palette.bg,
          borderBottomColor: palette.border,
          paddingTop: spacing.sm + (padsStatusBar ? insets.top : 0),
        },
      ]}
    >
      <Text style={[styles.title, { color: palette.text }]}>
        {t('emptyState.startupError.title', {
          defaultValue: 'Some parts of the app did not load',
        })}
      </Text>
      <Text style={[styles.detail, { color: palette.subtext }]}>
        {t('emptyState.startupError.detail', {
          areas: named,
          defaultValue: 'Could not load: {{areas}}. Restart the app to try again.',
        })}
      </Text>
      <Button
        label={t('emptyState.startupError.dismiss', { defaultValue: 'Dismiss' })}
        onPress={onDismiss}
        variant="ghost"
        size="sm"
        testID="startup-error-dismiss"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  title: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
  detail: {
    fontSize: typography.caption.fontSize,
  },
});
