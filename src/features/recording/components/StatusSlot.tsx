/**
 * The recording screen's single transient status slot. Shows at most one
 * message at a time (refused foreground service > failing crash backup > GPS
 * warning > sensor issue > km-split toast) with an animated swap, replacing the old stack of independent
 * banners.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { tapTo } from '@/shared/app/navigation';
import { colors, colorWithOpacity, darkColors, layout, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { selectStatusMessage, type StatusSlotInput } from '../lib/statusSlot';
import { OpenSettingsButton, pressable, pressRipple } from '@/shared/ui';
import { IconButton } from '@/shared/ui/IconButton';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

interface StatusSlotProps extends StatusSlotInput {
  onDismissGpsWarning: () => void;
}

function StatusSlotInner({
  backgroundTrackingWarning,
  backupWarning,
  gpsWarning,
  gpsWarningOpensSettings,
  sensorIssue,
  splitBanner,
  onDismissGpsWarning,
}: StatusSlotProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const message = selectStatusMessage({
    backgroundTrackingWarning,
    backupWarning,
    gpsWarning,
    gpsWarningOpensSettings,
    sensorIssue,
    splitBanner,
  });
  // A rider with the phone mounted or pocketed learns the slot by ear. A fault
  // interrupts, through an assertive live region on Android; a split waits.
  useAnnounceOnAppear(message?.spoken);
  if (!message) return null;

  // The amber has to be the mark here, not the ground: `colors.warning` is
  // 2.15:1 on white, so the row's text and icons take the deep tone instead.
  const amber = isDark ? darkColors.warningAmber : colors.warningAmber;

  // No dismiss: the ride still cannot record off screen after it is read, and
  // it clears itself if a later attempt succeeds.
  if (message.kind === 'background') {
    return (
      <Animated.View
        key="background"
        entering={FadeInDown.duration(200)}
        exiting={FadeOutUp.duration(150)}
        style={[styles.row, styles.warnRow]}
        testID="status-slot-background"
        accessibilityLiveRegion="assertive"
      >
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={amber} />
        <Text style={[styles.text, { color: amber }]}>{message.text}</Text>
      </Animated.View>
    );
  }

  // No dismiss either: it clears itself once a write lands, and reading it
  // does not make the next one land. Freeing storage does.
  if (message.kind === 'backup') {
    return (
      <Animated.View
        key="backup"
        entering={FadeInDown.duration(200)}
        exiting={FadeOutUp.duration(150)}
        style={[styles.row, styles.warnRow]}
        testID="status-slot-backup"
        accessibilityLiveRegion="assertive"
      >
        <MaterialCommunityIcons name="content-save-alert-outline" size={16} color={amber} />
        <Text style={[styles.text, { color: amber }]}>{message.text}</Text>
      </Animated.View>
    );
  }

  if (message.kind === 'gps') {
    return (
      <Animated.View
        key="gps"
        entering={FadeInDown.duration(200)}
        exiting={FadeOutUp.duration(150)}
        style={[styles.row, styles.warnRow]}
        testID="status-slot-gps"
        accessibilityLiveRegion="assertive"
      >
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={amber} />
        <Text style={[styles.text, { color: amber }]}>{message.text}</Text>
        {message.opensSettings && <OpenSettingsButton testID="status-slot-gps-settings" />}
        <IconButton onPress={onDismissGpsWarning} accessibilityLabel={t('common.close', 'Close')}>
          <MaterialCommunityIcons name="close" size={16} color={amber} />
        </IconButton>
      </Animated.View>
    );
  }

  if (message.kind === 'sensor') {
    return (
      <Animated.View
        key="sensor"
        entering={FadeInDown.duration(200)}
        exiting={FadeOutUp.duration(150)}
        testID="status-slot-sensor"
        accessibilityLiveRegion="assertive"
      >
        <Pressable
          style={pressable([styles.row, styles.warnRow])}
          android_ripple={pressRipple}
          onPress={() => tapTo('/sensor-settings')}
          accessibilityRole="button"
          accessibilityLabel={message.text}
        >
          <MaterialCommunityIcons name="bluetooth" size={16} color={amber} />
          <Text style={[styles.text, { color: amber }]}>{message.text}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={amber} />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      key="split"
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(150)}
      style={[styles.row, styles.splitRow]}
      testID="status-slot-split"
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={message.spoken}
    >
      <MaterialCommunityIcons name="flag-variant" size={16} color={colors.textOnDark} />
      <Text style={[styles.text, { color: colors.textOnDark }]}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
    borderRadius: layout.borderRadiusSm,
  },
  warnRow: {
    backgroundColor: colorWithOpacity(colors.warning, 0.15),
  },
  splitRow: {
    backgroundColor: colorWithOpacity(colors.success, 0.85),
  },
  text: {
    flex: 1,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
  },
});

/**
 * The recording screen re-renders every second while the timer runs, so the
 * parts of it that do not change with the clock are held here.
 */
export const StatusSlot = React.memo(StatusSlotInner);
