import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IntervalKind } from 'veloqrs';
import { measuresPower } from '@/shared/activity/activityUtils';
import { intervalTypeLabel } from '@/features/activity/lib/intervalTypeLabel';
import {
  formatDistance,
  formatDuration,
  formatSportSpeed,
  formatHeartRate,
  formatPower,
} from '@/shared/format/format';
import { intervalBandToken, resolveBandTextColour } from '@/features/stats';
import {
  spacing,
  typography,
  ink,
  colorWithOpacity,
  themedStyles,
  type Palette,
  stroke,
  opacity,
} from '@/theme';
import type { ActivityInterval, ActivityType } from '@/types';
import { ABSENT, absentLabel } from '@/shared/format/absent';
import { FitText } from '@/shared/ui/FitText';

interface IntervalsTableProps {
  intervals: ActivityInterval[];
  activityType: ActivityType;
  isMetric: boolean;
  isDark: boolean;
}

export function IntervalsTable({ intervals, activityType, isMetric, isDark }: IntervalsTableProps) {
  const { t } = useTranslation();
  const styles = themedStyles(makeStyles, isDark);
  const hasPowerZones = measuresPower(activityType);
  const hasHR = useMemo(() => intervals.some((i) => i.averageHeartrate != null), [intervals]);
  const hasPower = useMemo(() => intervals.some((i) => i.averageWatts != null), [intervals]);

  const renderItem = ({ item, index }: { item: ActivityInterval; index: number }) => {
    const isRecovery = item.kind === IntervalKind.Recovery || item.kind === IntervalKind.Rest;

    // The label is the text tone of the colour the interval's chip and band are drawn in.
    const token = intervalBandToken(item, hasPowerZones ? 'power' : 'hr');
    const labelColour = resolveBandTextColour(token, isDark);

    const distance = item.distance != null ? formatDistance(item.distance, isMetric) : ABSENT;
    const duration = item.movingTime != null ? formatDuration(item.movingTime) : ABSENT;
    const speed =
      item.averageSpeed == null || item.averageSpeed <= 0
        ? ABSENT
        : formatSportSpeed(item.averageSpeed, activityType, isMetric);
    const heartRate =
      item.averageHeartrate != null ? formatHeartRate(item.averageHeartrate) : ABSENT;
    const power = item.averageWatts != null ? formatPower(item.averageWatts) : ABSENT;

    const typeInput = {
      kind: item.kind,
      zone: item.zone,
      label: item.label,
      zoneColoured: token.kind === 'zone',
    };
    const typeLabel = intervalTypeLabel(typeInput);

    return (
      <View
        style={[
          styles.intervalRow,
          isRecovery && styles.intervalRowRecovery,
          index > 0 && styles.intervalRowBorder,
        ]}
      >
        <Text style={styles.indexText}>{index + 1}</Text>
        <FitText
          style={[styles.typeText, { color: labelColour }]}
          accessibilityLabel={intervalTypeLabel(typeInput, 'long')}
        >
          {typeLabel}
        </FitText>
        <View style={styles.statsRow}>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(distance, t)}>
            {distance}
          </Text>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(duration, t)}>
            {duration}
          </Text>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(speed, t)}>
            {speed}
          </Text>
          {hasHR ? (
            <Text style={styles.colStat} accessibilityLabel={absentLabel(heartRate, t)}>
              {heartRate}
            </Text>
          ) : null}
          {hasPower ? (
            <Text style={styles.colStat} accessibilityLabel={absentLabel(power, t)}>
              {power}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={intervals}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      scrollEnabled={false}
      initialNumToRender={20}
    />
  );
}

const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
    listContent: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xxs,
      gap: spacing.xsPlus,
    },
    intervalRowRecovery: {},
    intervalRowBorder: {
      borderTopWidth: stroke.hairline,
      borderTopColor: colorWithOpacity(isDark ? ink.white : ink.black, opacity.tint1),
    },
    indexText: {
      ...typography.captionBold,
      fontVariant: typography.tableValue.fontVariant,
      color: palette.textSecondary,
      width: 18,
      textAlign: 'center',
    },
    typeText: {
      ...typography.label,
      color: palette.textSecondary,
      width: 40,
    },
    statsRow: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.xs,
    },
    colStat: {
      ...typography.tableValue,
      fontSize: typography.caption.fontSize,
      lineHeight: typography.caption.lineHeight,
      color: palette.textPrimary,
      textAlign: 'right',
      flex: 1,
    },
  });
