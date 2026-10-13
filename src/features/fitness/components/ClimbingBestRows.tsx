import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useActivityLabels } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { ErrorState } from '@/shared/ui';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatClimbValue } from '../lib/bestEfforts';
import { SPORT_TEXT_COLORS, SPORT_TEXT_COLORS_DARK, type PrimarySport } from '../stores';
import type { ClimbBest } from '@/features/stats';
import { BestEffortRow } from './BestEffortRow';

interface ClimbingBestRowsProps {
  bests: ClimbBest[];
  sport: PrimarySport;
}

/** One climbing best per window: vertical power for the short ones, climbing rate for the long. */
export function ClimbingBestRows({ bests, sport }: ClimbingBestRowsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK[sport] : SPORT_TEXT_COLORS[sport];
  const units = {
    wattsPerKg: t('units.wattsPerKg'),
    metresPerHour: t('units.metresPerHour'),
    feetPerHour: t('units.feetPerHour'),
  };

  const ids = useMemo(
    () => bests.map((b) => b.activityId).filter((id): id is string => !!id),
    [bests]
  );
  const { labels, error, refetch } = useActivityLabels(ids);

  return (
    <View>
      {error != null && (
        <ErrorState
          variant="inline"
          error={error}
          onRetry={refetch}
          testID={`climbing-labels-failed-${sport}`}
        />
      )}
      {bests.map((best, index) => {
        const info = best.activityId ? labels.get(best.activityId) : undefined;
        return (
          <BestEffortRow
            key={best.windowS}
            testID={`season-bests-climbing-${best.windowS}`}
            label={best.label}
            value={formatClimbValue(best, isMetric, units)}
            valueColor={sportText}
            isLast={index === bests.length - 1}
            activity={info && best.activityId ? { id: best.activityId, ...info } : undefined}
          />
        );
      })}
    </View>
  );
}
