/**
 * The recording screen's single transient status slot. Shows at most one
 * message at a time (GPS warning > sensor issue > km-split toast) with an
 * animated swap, replacing the old stack of independent banners.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { navigateTo } from '@/shared/app/navigation';
import { colors, colorWithOpacity, layout, spacing, typography } from '@/theme';
import { selectStatusMessage, type StatusSlotInput } from '../lib/statusSlot';

interface StatusSlotProps extends StatusSlotInput {
  onDismissGpsWarning: () => void;
}

export function StatusSlot({
  gpsWarning,
  sensorIssue,
  splitBanner,
  onDismissGpsWarning,
}: StatusSlotProps) {
  const message = selectStatusMessage({ gpsWarning, sensorIssue, splitBanner });
  if (!message) return null;

  if (message.kind === 'gps') {
    return (
      <Animated.View
        key="gps"
        entering={FadeInDown.duration(200)}
        exiting={FadeOutUp.duration(150)}
        style={[styles.row, styles.warnRow]}
        testID="status-slot-gps"
      >
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.warning} />
        <Text style={[styles.text, { color: colors.warning }]}>{message.text}</Text>
        <TouchableOpacity
          onPress={onDismissGpsWarning}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="close" size={16} color={colors.warning} />
        </TouchableOpacity>
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
      >
        <TouchableOpacity
          style={[styles.row, styles.warnRow]}
          onPress={() => navigateTo('/sensor-settings')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={message.text}
        >
          <MaterialCommunityIcons name="bluetooth" size={16} color={colors.warning} />
          <Text style={[styles.text, { color: colors.warning }]}>{message.text}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.warning} />
        </TouchableOpacity>
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
    paddingVertical: spacing.xs + 2,
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
