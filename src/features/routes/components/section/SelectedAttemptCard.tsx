/**
 * The selected attempt under the performance chart. The panel decides which
 * attempt it is, so the card is never empty: this activity, else the most
 * recent attempt, until another one is chosen on the plot.
 *
 * On the left the name, with the reticle when it is this activity, then the
 * date and direction. On the right the attempt's figure in the basis the chart
 * plots on, with its standing against the record from the engine. Under them
 * one row of labelled actions: Open, Use as reference, Exclude or Include.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useOpenDetail } from '@/shared/app/MapSheetCards';
import { formatDuration, formatPower, formatShortDateWithYear } from '@/shared/format/format';
import { ChartMarkKey } from '@/shared/charts';
import { formatAttemptHeadline, type AttemptBasis } from '@/features/routes/lib/attemptBasis';
import { directionColour } from '@/features/routes/lib/directionColour';
import { scatterStanding, scatterStandingText } from '@/features/routes/lib/scatterMarks';
import { iconSize, type Palette, spacing, themedStyles, typography } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import type { FfiRecordStep } from 'veloqrs';
import { Button, Card } from '@/shared/ui';
import { Badge } from '@/shared/ui/Badge';
import { Icon } from '@/shared/ui/Icon';
import { NameText } from '@/shared/ui/NameText';

export interface SelectedAttemptCardProps {
  attempt: PerformanceDataPoint;
  isDark: boolean;
  activityType: ActivityType;
  /** What the figure and its standing read as, the basis the chart plots on. */
  basis: AttemptBasis;
  /** This activity, the one the screen was opened from, which has nowhere to open. */
  thisActivityId?: string | undefined;
  /** The record's progression in the attempt's direction, for the gain a new record made. */
  progression: readonly FfiRecordStep[];
  /** Every time stream is read, so the best attempt is the record. */
  recordsSettled: boolean;
  referenceActivityId?: string | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
}

export function SelectedAttemptCard({
  attempt,
  isDark,
  activityType,
  basis,
  thisActivityId,
  progression,
  recordsSettled,
  referenceActivityId,
  onSetAsReference,
  onExcludeActivity,
  onIncludeActivity,
}: SelectedAttemptCardProps) {
  const { t } = useTranslation();
  const openDetail = useOpenDetail();
  const isMetric = useMetricSystem();
  const styles = themedStyles(makeStyles, isDark);

  const activityId = attempt.activityId;
  const direction = attempt.direction === 'reverse' ? 'reverse' : 'forward';
  const isThisActivity = thisActivityId !== undefined && activityId === thisActivityId;
  const isRecord = recordsSettled && attempt.isBest === true && attempt.isExcluded !== true;
  const isReference = activityId === referenceActivityId;
  const axis = basis === 'time' ? 'time' : 'speed';
  const standing = recordsSettled
    ? scatterStandingText(
        scatterStanding(attempt, progression, axis),
        attempt,
        axis,
        activityType,
        isMetric,
        t
      )
    : null;
  const headline = formatAttemptHeadline(basis, attempt.sectionTime, attempt.speed, isMetric);
  const avgPower = attempt.avgPower;
  const power =
    avgPower != null && Number.isFinite(avgPower) && avgPower > 0 ? formatPower(avgPower) : null;
  const meta = [
    formatShortDateWithYear(attempt.date),
    t(direction === 'reverse' ? 'sections.reverse' : 'sections.forward'),
    basis !== 'time' && attempt.sectionTime != null ? formatDuration(attempt.sectionTime) : null,
    power,
  ].filter((part): part is string => !!part);
  const summary = [
    isThisActivity ? t('sections.legendThisActivity') : null,
    isRecord ? t('sections.legendRecord') : null,
    attempt.activityName,
    ...meta,
    headline,
    standing,
  ]
    .filter((part): part is string => !!part)
    .join(', ');

  return (
    <Card variant="flat" padding="sm" testID="selected-attempt-card">
      <View style={styles.facts} accessible accessibilityLabel={summary}>
        <View style={styles.left}>
          <View style={styles.nameRow}>
            {isThisActivity ? (
              <ChartMarkKey mark="reticle" testID="selected-attempt-this-activity" />
            ) : null}
            {isRecord ? (
              <Icon name="trophy" size={iconSize.xs} color={styles.record.color} />
            ) : null}
            <NameText style={styles.name}>{attempt.activityName}</NameText>
            {(attempt.lapCount ?? 0) > 1 ? (
              <Badge
                tone="neutral"
                text={t('units.times', { value: attempt.lapCount })}
                isDark={isDark}
              />
            ) : null}
          </View>
          <Text style={styles.meta}>{meta.join(' · ')}</Text>
        </View>
        <View style={styles.right}>
          <Text
            testID="selected-attempt-value"
            style={[styles.value, { color: directionColour(direction, isDark) }]}
          >
            {headline}
          </Text>
          {standing ? (
            <Text testID="selected-attempt-standing" style={isRecord ? styles.record : styles.meta}>
              {standing}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        {!isThisActivity ? (
          <Button
            variant="secondary"
            size="sm"
            label={t('sections.attemptOpen')}
            accessibilityLabel={`${t('sections.attemptOpen')}, ${attempt.activityName}`}
            onPress={() => openDetail({ kind: 'activity', id: activityId })}
            testID="selected-attempt-open"
          />
        ) : null}
        {onSetAsReference && attempt.isExcluded !== true ? (
          <Button
            variant="secondary"
            size="sm"
            label={isReference ? t('sections.legendReference') : t('sections.setAsReference')}
            disabled={isReference}
            onPress={() => onSetAsReference(activityId)}
            testID="selected-attempt-reference"
          />
        ) : null}
        {attempt.isExcluded === true && onIncludeActivity ? (
          <Button
            variant="secondary"
            size="sm"
            label={t('sections.attemptInclude')}
            onPress={() => onIncludeActivity(activityId)}
            testID="selected-attempt-include"
          />
        ) : attempt.isExcluded !== true && onExcludeActivity ? (
          <Button
            variant="secondary"
            size="sm"
            label={t('sections.attemptExclude')}
            onPress={() => onExcludeActivity(activityId)}
            testID="selected-attempt-exclude"
          />
        ) : null}
      </View>
    </Card>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    facts: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    left: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.xxs,
    },
    name: {
      ...typography.bodyCompactBold,
      color: palette.textPrimary,
      flexShrink: 1,
    },
    meta: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    right: {
      alignItems: 'flex-end',
      flexShrink: 0,
      maxWidth: '50%',
    },
    value: {
      ...typography.pillValue,
    },
    record: {
      ...typography.captionBold,
      color: palette.achievementText,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
  });
