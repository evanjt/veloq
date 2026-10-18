import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { themePalette } from '@/theme';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatClimbValue } from '../lib/bestEfforts';
import type { ClimbBest } from '@/features/stats';
import { BestEffortRow } from './BestEffortRow';

interface ClimbingBestRowsProps {
  bests: ClimbBest[];
}

/** One climbing best per window: vertical power for the short ones, climbing rate for the long. */
export function ClimbingBestRows({ bests }: ClimbingBestRowsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const valueInk = themePalette(isDark).textPrimary;
  const units = {
    wattsPerKg: t('units.wattsPerKg'),
    metresPerHour: t('units.metresPerHour'),
    feetPerHour: t('units.feetPerHour'),
  };

  return (
    <View>
      {bests.map((best, index) => {
        return (
          <BestEffortRow
            key={best.windowS}
            testID={`season-bests-climbing-${best.windowS}`}
            label={best.label}
            value={formatClimbValue(best, isMetric, units)}
            valueColor={valueInk}
            isLast={index === bests.length - 1}
            activity={
              best.activity && best.activityId
                ? { id: best.activityId, ...best.activity }
                : undefined
            }
          />
        );
      })}
    </View>
  );
}
