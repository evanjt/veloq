import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatFullDate } from '@/shared/format/format';
import { formatDecimal } from '@/shared/format/number';
import { formatWeight } from '@/shared/format/weight';
import { colors, spacing, typography } from '@/theme';
import { useWellnessDays } from '@/features/wellness';

import { calendarDayReadout, type LoggedMetric } from '../lib/calendarDayReadout';

interface CalendarDayReadoutProps {
  /** The selected day, or null for none. */
  date: string | null;
  /** The grid's first and last day, which is the one window read. */
  firstDay: string;
  lastDay: string;
}

/**
 * One line naming the selected day's fitness, fatigue and form, then each
 * wellness value logged that day. It holds its line while nothing is selected,
 * so a selection moves nothing below it.
 */
export function CalendarDayReadout({ date, firstDay, lastDay }: CalendarDayReadoutProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const days = useWellnessDays(firstDay, lastDay);

  if (!date)
    return (
      <Text testID="calendar-day-readout" style={styles.line}>
        {' '}
      </Text>
    );

  const readout = days ? calendarDayReadout(days.get(date)) : null;
  const labels: Record<LoggedMetric, string> = {
    hrv: t('metrics.hrv'),
    restingHR: t('wellness.restingHR'),
    sleepSecs: t('wellness.sleep'),
    sleepScore: t('wellness.sleepScore'),
    weight: t('metrics.weight'),
  };
  const whole = (value: number | null) => (value === null ? null : formatDecimal(value, 0));
  const format = (metric: LoggedMetric, value: number): string => {
    switch (metric) {
      case 'weight':
        return formatWeight(value, isMetric);
      case 'sleepSecs': {
        const minutes = Math.round(value / 60);
        return t('wellness.sleepDuration', {
          hours: Math.floor(minutes / 60),
          minutes: minutes % 60,
        });
      }
      default:
        return formatDecimal(value, 0);
    }
  };
  const parts: string[] = [];
  if (readout) {
    if (readout.fitness !== null) parts.push(`${t('metrics.fitness')} ${whole(readout.fitness)}`);
    if (readout.fatigue !== null) parts.push(`${t('metrics.fatigue')} ${whole(readout.fatigue)}`);
    if (readout.form !== null) parts.push(`${t('metrics.form')} ${whole(readout.form)}`);
    for (const l of readout.logged) parts.push(`${labels[l.metric]} ${format(l.metric, l.value)}`);
  }
  if (days && (!readout || readout.logged.length === 0)) parts.push(t('stats.noWellnessLogged'));

  return (
    <Text testID="calendar-day-readout" numberOfLines={2} style={styles.line}>
      {[formatFullDate(date), ...parts].join(' · ')}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    minHeight: 2 * typography.caption.lineHeight,
  },
});
