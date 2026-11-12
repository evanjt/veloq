import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExplanationCard, type ExplanationRow } from '@/shared/ui';
import { useSource } from '@/shared/app/source/useSource';
import { useChartColors } from '@/shared/charts';

interface FitnessDefinitionsCardProps {
  /** The fitness and fatigue days in effect today, null when the read gave none. */
  fitnessDays: number | null;
  fatigueDays: number | null;
}

/** What fitness, fatigue and form are, with the time constants in effect. */
export function FitnessDefinitionsCard({ fitnessDays, fatigueDays }: FitnessDefinitionsCardProps) {
  const { t } = useTranslation();
  const chartColors = useChartColors();
  const source = useSource();
  const links = source?.links ?? null;
  // A read that gave no days leaves fitness and fatigue undefined rather than
  // state time constants the athlete may not have.
  const rows: ExplanationRow[] = [
    ...(fitnessDays != null
      ? [
          {
            key: 'fitness',
            label: t('activity.stats.fitnessCTL'),
            text: t('fitnessScreen.fitnessDescription', { days: fitnessDays }),
            dotColor: chartColors.fitness,
          },
        ]
      : []),
    ...(fatigueDays != null
      ? [
          {
            key: 'fatigue',
            label: t('activity.stats.fatigueATL'),
            text: t('fitnessScreen.fatigueDescription', { days: fatigueDays }),
            dotColor: chartColors.fatigue,
          },
        ]
      : []),
    {
      key: 'form',
      label: t('activity.stats.formTSB'),
      text: t('fitnessScreen.formDescription'),
      dotColor: chartColors.formLine,
    },
    ...(source?.id === 'garmin' ? [{ key: 'method', text: t('fitnessScreen.methodGarmin') }] : []),
  ];
  return (
    <ExplanationCard
      title={t('fitnessScreen.understandingMetrics')}
      rows={rows}
      links={{
        heading: t('fitnessScreen.learnMore'),
        items: [
          ...(links
            ? [
                {
                  key: 'fitnessPage',
                  label: t('fitnessScreen.linkFitnessPage'),
                  url: links.fitnessPage,
                },
              ]
            : []),
          {
            key: 'trainingLoad',
            label: t('fitnessScreen.linkTrainingLoad'),
            url: 'https://www.sciencetosport.com/monitoring-training-load/',
          },
          {
            key: 'tsbManagement',
            label: t('fitnessScreen.linkTSBManagement'),
            url: 'https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html',
          },
        ],
      }}
    />
  );
}
