import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { navigateTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { KeyDot, Shimmer, TextSeparator, PressTarget } from '@/shared/ui';
import { colors, darkColors, layers, layout, spacing, typography } from '@/theme';
import { SummaryCardSparkline, SPARKLINE_MIN_DAYS, type ScrubValues } from './SummaryCardSparkline';
import { SummaryCardHRVSparkline } from './SummaryCardHRVSparkline';
import { Card } from '@/shared/ui/Card';
import { useMeasuredWidth } from '@/shared/charts';
import { useTranslation } from 'react-i18next';
import { getFormZone, formatForm } from '@/features/fitness';
import { summaryFormZoneColor, summarySeriesColor } from '@/features/home/lib/summaryMetricColour';
import { debug } from '@/shared/debug/debug';
import type { TrendGlyph } from '@/shared/format/trend';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formatSignedChange } from '../lib/fitnessChange';
import { ABSENT, absentLabel } from '@/shared/format/absent';

const log = debug.create('SummaryCard');

const SHIMMER_HERO_WIDTH = 38;
const SHIMMER_LABEL_WIDTH = 56;
const SHIMMER_METRIC_WIDTH = 28;

/**
 * Supporting metric displayed in the bottom row of SummaryCard
 */
interface SupportingMetric {
  label: string;
  /** The metric's name for a screen reader, the only thing it hears while values load. */
  name?: string | undefined;
  value: string | number;
  /** The unit the value is read in, drawn after it. */
  unit?: string | undefined;
  trend?: TrendGlyph | undefined;
  /** What a screen reader hears: the value, and what its arrow was judged against. */
  accessibilityLabel?: string | undefined;
  /** The route and chart a tap opens. */
  navigationTarget: string;
}

/**
 * The last day of a series, as the absent mark when that day carries an earlier day's value
 * rather than a reading of its own. Each series is indexed by its own length.
 */
function latestReading(
  series: number[] | undefined,
  read: boolean[] | undefined
): number | typeof ABSENT | undefined {
  if (!series || series.length === 0) return undefined;
  const last = series.length - 1;
  return read?.[last] === false ? ABSENT : series[last];
}

/**
 * Props for the SummaryCard component
 */
export interface SummaryCardProps {
  // Hero metric data
  heroMetric?: string | undefined;
  heroValue: number | string;
  heroLabel: string;
  /** The colour of the key dot beside the hero value; no dot without one. */
  heroKeyColor?: string | undefined;
  heroZone?: string | undefined;
  heroTrend?: TrendGlyph | undefined;
  /** The same for the hero, read when it draws its number and arrow alone. */
  heroAccessibilityLabel?: string | undefined;
  onHeroPress?: (() => void) | undefined;

  // Sparkline data (30 days) - fitness line + fatigue line + form zone bar
  fitnessData?: number[] | undefined;
  /** Last plotted fitness minus the first, from the engine. */
  fitnessDelta?: number | null | undefined;
  /** Indices into `fitnessData` of the days fitness rose, from the engine. */
  fitnessRiseDays?: number[] | undefined;
  fatigueData?: number[] | undefined;
  formData?: number[] | undefined;
  // HRV sparkline data - HRV line + RHR line
  hrvData?: number[] | undefined;
  rhrData?: number[] | undefined;
  /** Whether each HRV and RHR day had a reading of its own, beside the series. */
  hrvRead?: boolean[] | undefined;
  rhrRead?: boolean[] | undefined;
  showSparkline: boolean;
  /** Show inline labels on sparkline (settings preview) */
  showSparklineLabels?: boolean | undefined;

  // Supporting metrics (max 4)
  supportingMetrics: SupportingMetric[];

  /** The values are still outstanding: placeholders stand in for them, never a dash. */
  isLoading?: boolean | undefined;
}

/**
 * Summary card for the home screen hero section.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * │  +13  Form · Fresh                                       │
 * │                                                          │
 * │  ▁▂▃▅▇▆▅▃▂▁▂▃▅▆▇▅▃▂▁▃▅▆▇▆▅▃▂▁  30d                   │
 * │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
 * │                                                          │
 * │  Fitness 26↓  ·  FTP 155  ·  Week 1.6h  ·  Weight 72kg │
 * └──────────────────────────────────────────────────────────┘
 */
export const SummaryCard = React.memo(function SummaryCard({
  heroMetric = 'fitness',
  heroValue,
  heroLabel,
  heroKeyColor,
  heroZone,
  heroTrend,
  heroAccessibilityLabel,
  onHeroPress,
  fitnessData,
  fitnessDelta,
  fitnessRiseDays,
  fatigueData,
  formData,
  hrvData,
  rhrData,
  hrvRead,
  rhrRead,
  showSparkline,
  showSparklineLabels = false,
  supportingMetrics,
  isLoading = false,
}: SummaryCardProps) {
  const { t } = useTranslation();
  // The sparkline row fills the card, so its width is the card's inner width.
  const { width: sparklineWidth, onLayout: onSparklineLayout } = useMeasuredWidth();
  if (__DEV__) {
    const start = performance.now();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      const dur = performance.now() - start;
      if (dur > 20) log.log(`  📊 SummaryCard render: ${dur.toFixed(0)}ms`);
    });
  }
  const { isDark } = useTheme();
  const [scrubValues, setScrubValues] = useState<ScrubValues | null>(null);
  const [sparklinesReady, setSparklinesReady] = useState(false);
  useEffect(() => {
    return runWhenIdle(() => setSparklinesReady(true));
  }, []);

  const handleScrub = useCallback((values: ScrubValues | null) => {
    setScrubValues(values);
  }, []);

  // Determine which sparkline to show - deferred until after first frame
  const isHrvMode = heroMetric === 'hrv';
  const isFormMode = heroMetric === 'form';
  // The series a sparkline needs are carried on the flag rather than checked
  // again at the call site, so the plot cannot be reached without them.
  const showAny = sparklinesReady && showSparkline;
  const fitnessSparkline =
    showAny &&
    !isHrvMode &&
    fitnessData &&
    formData &&
    fitnessData.length >= SPARKLINE_MIN_DAYS &&
    formData.length >= SPARKLINE_MIN_DAYS
      ? { fitness: fitnessData, form: formData }
      : null;
  const hrvSparkline =
    showAny && isHrvMode && hrvData && hrvData.length >= SPARKLINE_MIN_DAYS ? hrvData : null;

  const fitnessChange = formatSignedChange(fitnessDelta);

  // Text is never set in a series colour: a value is primary ink, a label
  // secondary, and a series value carries a key dot in the colour of its line.
  const valueInk = isDark ? darkColors.textPrimary : colors.textPrimary;
  const labelInk = isDark ? darkColors.textSecondary : colors.textSecondary;
  const fitnessKey = summarySeriesColor('fitness', isDark);
  const fatigueKey = summarySeriesColor('fatigue', isDark);
  const hrvKey = summarySeriesColor('hrv', isDark);
  const rhrKey = summarySeriesColor('rhr', isDark);

  // Current fitness sparkline values (latest or scrubbed)
  const lastIdx = fitnessData ? fitnessData.length - 1 : 0;
  const currentFitness = scrubValues ? scrubValues.fitness : (fitnessData?.[lastIdx] ?? 0);
  const currentFatigue = scrubValues ? scrubValues.fatigue : (fatigueData?.[lastIdx] ?? null);
  const currentForm = scrubValues ? scrubValues.form : (formData?.[lastIdx] ?? 0);
  const asPercent = useFormPreference((s) => s.formAsPercent) === true;
  const currentFormZone = getFormZone(currentForm, currentFitness, asPercent);
  const currentFormKey = currentFormZone
    ? summaryFormZoneColor(currentFormZone, isDark)
    : undefined;
  const displayValue =
    scrubValues !== null
      ? isHrvMode
        ? (scrubValues.hrv ?? heroValue)
        : isFormMode
          ? (formatForm(scrubValues.form, scrubValues.fitness, asPercent) ?? ABSENT)
          : scrubValues.fitness
      : heroValue;
  const displayKey =
    scrubValues !== null
      ? isHrvMode
        ? hrvKey
        : isFormMode
          ? currentFormKey
          : fitnessKey
      : heroKeyColor;
  const formattedHeroValue = String(displayValue);

  // Current HRV sparkline values (latest or scrubbed). A day with no reading of its own,
  // scrubbed or today, reads the absent mark, not the value the line carries over it from
  // an earlier day.
  const latestHrv = latestReading(hrvData, hrvRead);
  const latestRhr = latestReading(rhrData, rhrRead);
  const currentHrv = scrubValues
    ? scrubValues.hrv === null
      ? ABSENT
      : (scrubValues.hrv ?? latestHrv ?? 0)
    : (latestHrv ?? 0);
  const currentRhr = scrubValues
    ? scrubValues.rhr === null
      ? ABSENT
      : (scrubValues.rhr ?? null)
    : (latestRhr ?? null);

  return (
    <View>
      <Card variant="raised" padding="none">
        <View style={styles.cardContent}>
          {/* Scrub date label - top right of card */}
          {scrubValues ? (
            <Text style={[styles.scrubDate, { color: labelInk }]}>{scrubValues.dateLabel}</Text>
          ) : null}

          {/* Top row: Hero value + zone */}
          <View style={styles.topRow}>
            {/* Hero metric - tappable */}
            <PressTarget
              accessibilityRole={onHeroPress ? 'button' : undefined}
              // Only the plain hero is one number and its arrow; a sparkline
              // hero reads several numbers, each its own text.
              accessibilityLabel={
                isLoading || fitnessSparkline || hrvSparkline ? undefined : heroAccessibilityLabel
              }
              testID="summary-card-hero"
              style={styles.heroSection}
              onPress={onHeroPress}
              disabled={!onHeroPress}
            >
              {isLoading ? (
                <View style={styles.heroValueRow}>
                  <View testID="summary-card-hero-shimmer">
                    <Shimmer width={SHIMMER_HERO_WIDTH} height={28} />
                  </View>
                  <View testID="summary-card-hero-label-shimmer">
                    <Shimmer width={SHIMMER_LABEL_WIDTH} height={16} />
                  </View>
                </View>
              ) : fitnessSparkline ? (
                <View>
                  <View style={styles.heroValueRow}>
                    {isFormMode ? (
                      currentFormKey ? (
                        <KeyDot testID="summary-card-key-form" color={currentFormKey} />
                      ) : null
                    ) : (
                      <KeyDot testID="summary-card-key-fitness" color={fitnessKey} />
                    )}
                    <Text style={[styles.heroValueFixed, { color: valueInk }]}>
                      {isFormMode
                        ? (formatForm(currentForm, currentFitness, asPercent) ?? ABSENT)
                        : currentFitness}
                    </Text>
                    <Text style={[styles.heroLabel, { color: labelInk }]}>
                      {t(isFormMode ? 'metrics.form' : 'metrics.fitness')}
                    </Text>
                    {!isFormMode && !scrubValues && fitnessChange !== null && (
                      <Text
                        testID="summary-card-fitness-change"
                        accessibilityHint={t('summaryCardChange.rule')}
                        style={[styles.heroSubText, { color: labelInk }]}
                      >
                        {t('summaryCardChange.window', {
                          change: fitnessChange,
                          count: fitnessSparkline.fitness.length,
                        })}
                      </Text>
                    )}
                  </View>
                  <View style={styles.heroSubLine}>
                    {isFormMode ? (
                      <Text style={[styles.heroSubText, { color: labelInk }]}>
                        {currentFormZone ? t(`formZones.${currentFormZone}`) : ''}
                      </Text>
                    ) : null}
                    {!isFormMode && currentFatigue !== null && (
                      <View style={styles.keyedValue}>
                        <KeyDot testID="summary-card-key-fatigue" color={fatigueKey} />
                        <Text style={[styles.heroSubText, { color: labelInk }]}>
                          <Text style={{ color: valueInk }}>{currentFatigue}</Text>{' '}
                          {t('metrics.fatigue')}
                        </Text>
                      </View>
                    )}
                    {!isFormMode && (
                      <View style={styles.keyedValue}>
                        {currentFormKey ? (
                          <KeyDot testID="summary-card-key-form" color={currentFormKey} />
                        ) : null}
                        <Text style={[styles.heroSubText, { color: labelInk }]}>
                          <Text style={{ color: valueInk }}>
                            {formatForm(currentForm, currentFitness, asPercent) ?? ''}
                          </Text>{' '}
                          {currentFormZone ? t(`formZones.${currentFormZone}`) : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ) : hrvSparkline ? (
                <View style={styles.heroValueRow}>
                  <KeyDot testID="summary-card-key-hrv" color={hrvKey} />
                  <Text
                    testID="summary-card-hrv-value"
                    style={[styles.heroValueFixed, { color: valueInk }]}
                    accessibilityLabel={absentLabel(String(currentHrv), t)}
                  >
                    {currentHrv}
                    {typeof currentHrv === 'number' ? (
                      <Text style={styles.heroUnit}> {t('units.ms')}</Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.heroLabel, { color: labelInk }]}>{t('metrics.hrv')}</Text>
                  {currentRhr !== null && (
                    <>
                      <KeyDot testID="summary-card-key-rhr" color={rhrKey} />
                      <Text
                        testID="summary-card-rhr-value"
                        style={[styles.secondaryValueFixed, { color: valueInk }]}
                        accessibilityLabel={absentLabel(String(currentRhr), t)}
                      >
                        {currentRhr}
                        {typeof currentRhr === 'number' ? (
                          <Text style={styles.secondaryUnit}> {t('units.bpm')}</Text>
                        ) : null}
                      </Text>
                      <Text style={[styles.secondaryLabel, { color: labelInk }]}>
                        {t('metrics.rhr')}
                      </Text>
                    </>
                  )}
                </View>
              ) : (
                <View style={styles.heroValueRow}>
                  {displayKey ? <KeyDot testID="summary-card-key-hero" color={displayKey} /> : null}
                  <Text style={[styles.heroValue, { color: valueInk }]}>
                    {formattedHeroValue}
                    {isHrvMode && typeof displayValue === 'number' ? (
                      <Text style={styles.heroUnit}> {t('units.ms')}</Text>
                    ) : null}
                    {!scrubValues && heroTrend ? (
                      <Text style={styles.heroTrend}>{heroTrend}</Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.heroLabel, { color: labelInk }]}>{heroLabel}</Text>
                  {isFormMode && heroZone ? (
                    <Text style={[styles.heroSubText, { color: labelInk }]}>{heroZone}</Text>
                  ) : null}
                </View>
              )}
            </PressTarget>
          </View>

          {/* Sparkline row - fitness or HRV depending on hero metric */}
          {fitnessSparkline ? (
            <View
              testID="summary-card-sparkline"
              style={styles.sparklineRow}
              onLayout={onSparklineLayout}
            >
              <SummaryCardSparkline
                fitnessData={fitnessSparkline.fitness}
                fatigueData={fatigueData}
                riseDays={fitnessRiseDays}
                formData={fitnessSparkline.form}
                width={sparklineWidth}
                showLabels={showSparklineLabels}
                onScrub={showSparklineLabels ? undefined : handleScrub}
                onTap={showSparklineLabels ? undefined : onHeroPress}
              />
            </View>
          ) : null}
          {hrvSparkline ? (
            <View
              testID="summary-card-hrv-sparkline"
              style={styles.sparklineRow}
              onLayout={onSparklineLayout}
            >
              <SummaryCardHRVSparkline
                hrvData={hrvSparkline}
                rhrData={rhrData}
                hrvRead={hrvRead}
                rhrRead={rhrRead}
                width={sparklineWidth}
                onScrub={showSparklineLabels ? undefined : handleScrub}
                onTap={showSparklineLabels ? undefined : onHeroPress}
              />
            </View>
          ) : null}

          {/* Supporting metrics row - each metric tappable */}
          <View testID="summary-card-supporting" style={styles.supportingRow}>
            {supportingMetrics.slice(0, 4).map((metric, index) => (
              <React.Fragment key={metric.label}>
                {index > 0 && (
                  <TextSeparator
                    style={[styles.metricDivider, isDark && styles.metricDividerDark]}
                  />
                )}
                <PressTarget
                  accessibilityRole="button"
                  testID={`summary-card-metric-${index}`}
                  accessibilityLabel={isLoading ? metric.name : metric.accessibilityLabel}
                  style={styles.supportingMetric}
                  onPress={() => navigateTo(metric.navigationTarget)}
                >
                  <Text style={[styles.metricLabel, { color: labelInk }]}>{metric.label}</Text>
                  {isLoading ? (
                    <View testID={`summary-card-metric-${index}-shimmer`}>
                      <Shimmer width={SHIMMER_METRIC_WIDTH} height={14} />
                    </View>
                  ) : (
                    <Text
                      style={[styles.metricValue, { color: valueInk }]}
                      accessibilityLabel={absentLabel(String(metric.value), t)}
                    >
                      {metric.value}
                      {metric.unit ? <Text style={styles.metricUnit}> {metric.unit}</Text> : null}
                      {metric.trend ? <Text style={styles.metricTrend}>{metric.trend}</Text> : null}
                    </Text>
                  )}
                </PressTarget>
              </React.Fragment>
            ))}
          </View>
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  cardContent: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // Scrub date - top right corner
  scrubDate: {
    ...typography.micro,
    position: 'absolute',
    top: spacing.xs,
    right: spacing.md,
    zIndex: layers.raised,
  },

  // Top row - hero inline
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  // Hero section - inline horizontal
  // The hero takes the row's width, and its rows wrap so large
  // text drops the change line below the value rather than past the card.
  heroSection: {
    flex: 1,
    justifyContent: 'center',
  },
  heroValueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroSubLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 0,
  },
  // A key dot and the value it keys. The pair wraps and shrinks inside the
  // line, so large text drops the words below the dot rather than past the card.
  keyedValue: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroSubText: {
    ...typography.caption,
  },
  heroValue: {
    ...typography.statsValueLarge,
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  heroValueFixed: {
    ...typography.statsValueLarge,
    lineHeight: 28,
    letterSpacing: -0.5,
    minWidth: 38,
    textAlign: 'right' as const,
  },
  secondaryValueFixed: {
    ...typography.bodyBold,
    lineHeight: 20,
    letterSpacing: -0.3,
    minWidth: 30,
    textAlign: 'right' as const,
    flexShrink: 1,
  },
  secondaryLabel: {
    ...typography.caption,
    flexShrink: 1,
  },
  heroUnit: {
    ...typography.bodySmall,
    letterSpacing: 0,
  },
  secondaryUnit: {
    ...typography.caption,
    letterSpacing: 0,
  },
  heroTrend: {
    fontSize: typography.cardTitle.fontSize,
    marginLeft: spacing.xxs,
  },
  heroLabel: {
    ...typography.bodySmall,
  },
  // Sparkline - own row, full width
  sparklineRow: {
    marginTop: spacing.xs,
  },
  // Supporting metrics row. The metrics fill the row's height rather than
  // reaching it through slop, which would take the sparkline's taps above them.
  supportingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xxs,
  },
  supportingMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minHeight: layout.minTapTarget,
  },
  metricLabel: {
    ...typography.caption,
  },
  metricValue: {
    ...typography.captionBold,
  },
  metricUnit: {
    ...typography.micro,
  },
  metricTrend: {
    fontSize: typography.micro.fontSize,
    marginLeft: spacing.xxs,
  },
  metricDivider: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.xs,
  },
  metricDividerDark: {
    color: darkColors.textSecondary,
  },
});
