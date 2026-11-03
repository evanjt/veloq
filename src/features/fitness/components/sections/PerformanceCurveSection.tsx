import React from 'react';
import { curveHeaderValue } from '@/features/fitness/lib/curveHeaderValue';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Card } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  usePowerCurve,
  usePaceCurve,
  PowerCurveChart,
  PaceCurveChart,
  SwimPaceCurveChart,
  CurveFreshnessLine,
  curveFreshness,
} from '@/features/stats';
import { useTheme } from '@/shared/app';
import { type PrimarySport } from '@/features/fitness/stores';
import {
  formatPaceCompact,
  formatPower,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { iconSize, spacing, themePalette, typography } from '@/theme';

interface PerformanceCurveSectionProps {
  sportMode: PrimarySport;
  days: number;
  currentFTP: number | null | undefined;
  thresholdPace: number | undefined;
  swimThresholdPace: number | undefined;
}

export const PerformanceCurveSection = React.memo(function PerformanceCurveSection({
  sportMode,
  days,
  currentFTP,
  thresholdPace,
  swimThresholdPace,
}: PerformanceCurveSectionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const valueInk = themePalette(isDark).textPrimary;

  // The chart under each row decides whether there is a series, so the header
  // asks the same query it does. Both read one cache entry.
  const powerCurve = usePowerCurve({ days, enabled: sportMode === 'Cycling' });
  const runCurve = usePaceCurve({ sport: 'Run', days, enabled: sportMode === 'Running' });
  const swimCurve = usePaceCurve({ sport: 'Swim', days, enabled: sportMode === 'Swimming' });

  const headerFtp = curveHeaderValue({
    value: currentFTP,
    hasSeries: powerCurve.data.secs.length > 0,
    isLoading: powerCurve.isLoading,
    isError: powerCurve.isError,
  });
  const headerRunPace = curveHeaderValue({
    value: thresholdPace,
    hasSeries: runCurve.data.distances.length > 0,
    isLoading: runCurve.isLoading,
    isError: runCurve.isError,
  });
  const headerSwimPace = curveHeaderValue({
    value: swimThresholdPace,
    hasSeries: swimCurve.data.distances.length > 0,
    isLoading: swimCurve.isLoading,
    isError: swimCurve.isError,
  });

  // The curve on screen is a stored body, so the line dates its fetch.
  const sportCurve =
    sportMode === 'Cycling' ? powerCurve : sportMode === 'Running' ? runCurve : swimCurve;
  const freshness = curveFreshness({
    fetchedAt: sportCurve.fetchedAt,
    isLoading: sportCurve.isLoading,
  });

  const title =
    sportMode === 'Cycling'
      ? t('statsScreen.powerCurve')
      : sportMode === 'Swimming'
        ? t('statsScreen.swimPaceCurve')
        : t('statsScreen.paceCurve');
  const headerValue =
    sportMode === 'Cycling' && headerFtp
      ? t('statsScreen.ftpLabel', { value: formatPower(headerFtp) })
      : sportMode === 'Running' && headerRunPace
        ? `${formatPaceCompact(headerRunPace, isMetric)}${paceUnitLabel(isMetric)}`
        : sportMode === 'Swimming' && headerSwimPace
          ? `${formatSwimPace(headerSwimPace, isMetric)}${swimPaceUnitLabel(isMetric)}`
          : null;

  return (
    <View style={styles.frame} testID="fitness-performance-curve">
      <Card variant="flat">
        <View style={styles.header}>
          <Icon
            name={sportMode === 'Cycling' ? 'lightning-bolt' : 'speedometer'}
            size={iconSize.md}
            color={valueInk}
            style={styles.headerIcon}
          />
          <Text accessibilityRole="header" style={[styles.title, { color: valueInk }]}>
            {title}
          </Text>
          {headerValue ? (
            <Text style={[styles.headerValue, { color: valueInk }]}>{headerValue}</Text>
          ) : null}
        </View>
        <CurveFreshnessLine freshness={freshness} />
        {sportMode === 'Cycling' && <PowerCurveChart days={days} ftp={currentFTP} />}
        {sportMode === 'Running' && <PaceCurveChart days={days} />}
        {sportMode === 'Swimming' && <SwimPaceCurveChart days={days} />}
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerIcon: {
    marginRight: spacing.sm,
  },
  title: {
    ...typography.bodyBold,
    flex: 1,
  },
  headerValue: {
    ...typography.bodyBold,
    marginLeft: spacing.sm,
  },
});
