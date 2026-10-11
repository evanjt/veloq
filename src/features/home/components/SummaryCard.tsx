import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Pressable, Image, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { tapTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { canDrawProfilePhoto, Shimmer, pressable, pressRipple } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography, shadows, opacity } from '@/theme';
import { SummaryCardSparkline, SPARKLINE_MIN_DAYS, type ScrubValues } from './SummaryCardSparkline';
import { SummaryCardHRVSparkline } from './SummaryCardHRVSparkline';
import { Card } from '@/shared/ui/Card';
import { useTranslation } from 'react-i18next';
import { getFormZone, formatForm, formZoneTextColor } from '@/features/fitness';
import { debug } from '@/shared/debug/debug';
import type { TrendGlyph } from '@/shared/format/trend';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formatSignedChange } from '../lib/fitnessChange';

const log = debug.create('SummaryCard');

const SHIMMER_HERO_WIDTH = 38;
const SHIMMER_LABEL_WIDTH = 56;
const SHIMMER_METRIC_WIDTH = 28;

/**
 * Supporting metric displayed in the bottom row of SummaryCard
 */
interface SupportingMetric {
  label: string;
  value: string | number;
  color?: string | undefined;
  trend?: TrendGlyph | undefined;
  /** What a screen reader hears: the value, and what its arrow was judged against. */
  accessibilityLabel?: string | undefined;
  /** The route and chart a tap opens. */
  navigationTarget: string;
}

/**
 * Props for the SummaryCard component
 */
export interface SummaryCardProps {
  // Profile
  profileUrl?: string | undefined;
  onProfilePress: () => void;

  // Hero metric data
  heroMetric?: string | undefined;
  heroValue: number | string;
  heroLabel: string;
  heroColor: string;
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
 * │  [👤⚙]   +13  Form · Fresh                              │
 * │                                                          │
 * │  ▁▂▃▅▇▆▅▃▂▁▂▃▅▆▇▅▃▂▁▃▅▆▇▆▅▃▂▁  30d                   │
 * │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
 * │                                                          │
 * │  Fitness 26↓  ·  FTP 155  ·  Week 1.6h  ·  Weight 72kg │
 * └──────────────────────────────────────────────────────────┘
 */
export const SummaryCard = React.memo(function SummaryCard({
  profileUrl,
  onProfilePress,
  heroMetric = 'fitness',
  heroValue,
  heroLabel,
  heroColor,
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
  const { width: windowWidth } = useWindowDimensions();
  if (__DEV__) {
    const start = performance.now();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      const dur = performance.now() - start;
      if (dur > 20) log.log(`  📊 SummaryCard render: ${dur.toFixed(0)}ms`);
    });
  }
  const { isDark, colors: themeColors } = useTheme();
  const [profileImageError, setProfileImageError] = React.useState(false);
  const [scrubValues, setScrubValues] = useState<ScrubValues | null>(null);
  const [sparklinesReady, setSparklinesReady] = useState(false);
  useEffect(() => {
    return runWhenIdle(() => setSparklinesReady(true));
  }, []);

  const handleScrub = useCallback((values: ScrubValues | null) => {
    setScrubValues(values);
  }, []);

  const canDrawPhoto = canDrawProfilePhoto(profileUrl, profileImageError);

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

  // During scrub, override the hero display
  // Headline numbers, so they are text and hold 4.5:1. The series fills they
  // read from are 2.66:1 and 3.17:1 on the light card.
  const fitnessTextColor = isDark ? darkColors.fitnessBlueText : colors.fitnessBlueText;
  const fatigueTextColor = isDark ? darkColors.chartPinkText : colors.chartPinkText;
  const hrvTextColor = isDark ? darkColors.chartHrvText : colors.chartHrvText;

  // Current fitness sparkline values (latest or scrubbed)
  const lastIdx = fitnessData ? fitnessData.length - 1 : 0;
  const currentFitness = scrubValues ? scrubValues.fitness : (fitnessData?.[lastIdx] ?? 0);
  const currentFatigue = scrubValues ? scrubValues.fatigue : (fatigueData?.[lastIdx] ?? null);
  const currentForm = scrubValues ? scrubValues.form : (formData?.[lastIdx] ?? 0);
  const asPercent = useFormPreference((s) => s.formAsPercent) === true;
  const currentFormZone = getFormZone(currentForm, currentFitness, asPercent);
  const currentFormColor = currentFormZone
    ? formZoneTextColor(currentFormZone, isDark)
    : isDark
      ? darkColors.textPrimary
      : colors.textPrimary;
  const displayValue =
    scrubValues !== null
      ? isHrvMode
        ? (scrubValues.hrv ?? heroValue)
        : isFormMode
          ? (formatForm(scrubValues.form, scrubValues.fitness, asPercent) ?? '-')
          : scrubValues.fitness
      : heroValue;
  const displayColor =
    scrubValues !== null
      ? isHrvMode
        ? hrvTextColor
        : isFormMode
          ? currentFormColor
          : fitnessTextColor
      : heroColor;
  const formattedHeroValue = String(displayValue);
  // Resting HR is a value and a label beside the line drawn in its series
  // colour, so it takes that series' text tone.
  const rhrColor = isDark ? darkColors.chartRhrText : colors.chartRhrText;

  // Current HRV sparkline values (latest or scrubbed)
  const hrvLastIdx = hrvData ? hrvData.length - 1 : 0;
  // A scrubbed day with no reading of its own reads '-', not the value the
  // line carries over it from an earlier day.
  const currentHrv = scrubValues
    ? scrubValues.hrv === null
      ? '-'
      : (scrubValues.hrv ?? hrvData?.[hrvLastIdx] ?? 0)
    : (hrvData?.[hrvLastIdx] ?? 0);
  const currentRhr = scrubValues
    ? scrubValues.rhr === null
      ? '-'
      : (scrubValues.rhr ?? null)
    : (rhrData?.[hrvLastIdx] ?? null);

  // Compute explicit sparkline width (screen minus card margins and padding)
  const sparklineWidth = windowWidth - layout.screenPadding * 2 - spacing.md * 2;

  return (
    <View>
      <Card variant="raised" padding="none">
        <View style={styles.cardContent}>
          {/* Scrub date label - top right of card */}
          {scrubValues && (
            <Text
              style={[
                styles.scrubDate,
                {
                  color: isDark ? darkColors.textSecondary : colors.textSecondary,
                },
              ]}
            >
              {scrubValues.dateLabel}
            </Text>
          )}

          {/* Top row: Profile + Hero value + zone */}
          <View style={styles.topRow}>
            {/* Profile photo with gear badge */}
            <Pressable
              onPress={onProfilePress}
              style={pressable(styles.profileTouchArea)}
              accessibilityLabel={t('common.openSettings')}
              accessibilityRole="button"
              android_ripple={pressRipple}
            >
              <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
                {canDrawPhoto ? (
                  <Image
                    source={{ uri: profileUrl }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="account"
                    size={22}
                    color={themeColors.textSecondary}
                  />
                )}
              </View>
              {/* Gear badge */}
              <View style={[styles.gearBadge, isDark && styles.gearBadgeDark]}>
                <MaterialCommunityIcons
                  name="cog"
                  size={10}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </View>
            </Pressable>

            {/* Hero metric - tappable */}
            <Pressable
              accessibilityRole={onHeroPress ? 'button' : undefined}
              // Only the plain hero is one number and its arrow; a sparkline
              // hero reads several numbers, each its own text.
              accessibilityLabel={
                isLoading || fitnessSparkline || hrvSparkline ? undefined : heroAccessibilityLabel
              }
              style={pressable(styles.heroSection)}
              android_ripple={pressRipple}
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
                    <Text
                      style={[
                        styles.heroValueFixed,
                        { color: isFormMode ? currentFormColor : fitnessTextColor },
                      ]}
                    >
                      {isFormMode
                        ? (formatForm(currentForm, currentFitness, asPercent) ?? '-')
                        : currentFitness}
                    </Text>
                    <Text
                      style={[
                        styles.heroLabel,
                        { color: isFormMode ? currentFormColor : fitnessTextColor },
                      ]}
                    >
                      {t(isFormMode ? 'metrics.form' : 'metrics.fitness')}
                    </Text>
                    {!isFormMode && !scrubValues && fitnessChange !== null && (
                      <Text
                        testID="summary-card-fitness-change"
                        accessibilityHint={t('summaryCardChange.rule')}
                        style={[styles.heroSubText, { color: fitnessTextColor }]}
                      >
                        {t('summaryCardChange.window', {
                          change: fitnessChange,
                          count: fitnessSparkline.fitness.length,
                        })}
                      </Text>
                    )}
                  </View>
                  <View style={styles.heroSubLine}>
                    {isFormMode && (
                      <Text style={[styles.heroSubText, { color: currentFormColor }]}>
                        {currentFormZone ? t(`formZones.${currentFormZone}`) : ''}
                      </Text>
                    )}
                    {!isFormMode && currentFatigue !== null && (
                      <Text style={[styles.heroSubText, { color: fatigueTextColor }]}>
                        {currentFatigue} {t('metrics.fatigue')}
                      </Text>
                    )}
                    {!isFormMode && (
                      <Text style={[styles.heroSubText, { color: currentFormColor }]}>
                        {formatForm(currentForm, currentFitness, asPercent) ?? ''}{' '}
                        {currentFormZone ? t(`formZones.${currentFormZone}`) : ''}
                      </Text>
                    )}
                  </View>
                </View>
              ) : hrvSparkline ? (
                <View style={styles.heroValueRow}>
                  <Text
                    testID="summary-card-hrv-value"
                    style={[styles.heroValueFixed, { color: hrvTextColor }]}
                  >
                    {currentHrv}
                  </Text>
                  <Text style={[styles.heroLabel, { color: hrvTextColor }]}>
                    {t('metrics.hrv')}
                  </Text>
                  {currentRhr !== null && (
                    <>
                      <Text
                        testID="summary-card-rhr-value"
                        style={[styles.secondaryValueFixed, { color: rhrColor }]}
                      >
                        {currentRhr}
                      </Text>
                      <Text style={[styles.secondaryLabel, { color: rhrColor }]}>
                        {t('metrics.rhr')}
                      </Text>
                    </>
                  )}
                </View>
              ) : (
                <View style={styles.heroValueRow}>
                  <Text style={[styles.heroValue, { color: displayColor }]}>
                    {formattedHeroValue}
                    {!scrubValues && heroTrend && <Text style={styles.heroTrend}>{heroTrend}</Text>}
                  </Text>
                  <Text style={[styles.heroLabel, isDark && styles.textSecondary]}>
                    {heroLabel}
                  </Text>
                  {isFormMode && heroZone && (
                    <Text style={[styles.heroSubText, { color: displayColor }]}>{heroZone}</Text>
                  )}
                </View>
              )}
            </Pressable>
          </View>

          {/* Sparkline row - fitness or HRV depending on hero metric */}
          {fitnessSparkline && (
            <View testID="summary-card-sparkline" style={styles.sparklineRow}>
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
          )}
          {hrvSparkline && (
            <View testID="summary-card-hrv-sparkline" style={styles.sparklineRow}>
              <SummaryCardHRVSparkline
                hrvData={hrvSparkline}
                rhrData={rhrData}
                hrvRead={hrvRead}
                rhrRead={rhrRead}
                width={sparklineWidth}
                showLabels={showSparklineLabels}
                onScrub={showSparklineLabels ? undefined : handleScrub}
                onTap={showSparklineLabels ? undefined : onHeroPress}
              />
            </View>
          )}

          {/* Supporting metrics row - each metric tappable */}
          <View style={styles.supportingRow}>
            {supportingMetrics.slice(0, 4).map((metric, index) => (
              <React.Fragment key={metric.label}>
                {index > 0 && (
                  <Text style={[styles.metricDivider, isDark && styles.metricDividerDark]}>
                    {'\u00B7'}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  testID={`summary-card-metric-${index}`}
                  accessibilityLabel={isLoading ? undefined : metric.accessibilityLabel}
                  style={pressable(styles.supportingMetric)}
                  android_ripple={pressRipple}
                  onPress={() => tapTo(metric.navigationTarget)}
                >
                  <Text style={[styles.metricLabel, isDark && styles.textSecondary]}>
                    {metric.label}
                  </Text>
                  {isLoading ? (
                    <View testID={`summary-card-metric-${index}-shimmer`}>
                      <Shimmer width={SHIMMER_METRIC_WIDTH} height={14} />
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.metricValue,
                        {
                          color:
                            metric.color || (isDark ? darkColors.textPrimary : colors.textPrimary),
                        },
                      ]}
                    >
                      {metric.value}
                      {metric.trend && <Text style={styles.metricTrend}>{metric.trend}</Text>}
                    </Text>
                  )}
                </Pressable>
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
    position: 'absolute',
    top: spacing.xs,
    right: spacing.md,
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    zIndex: 1,
  },

  // Top row - profile + hero inline
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  // Profile photo with gear badge
  profileTouchArea: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    position: 'relative',
  },
  profilePhoto: {
    width: 40,
    height: 40,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: opacity.overlay.medium,
  },
  profilePhotoDark: {
    backgroundColor: darkColors.border,
    borderColor: opacity.overlayDark.heavy,
  },
  gearBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.pill,
  },
  gearBadgeDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
    ...shadows.none,
  },

  // Hero section - inline horizontal
  heroSection: {
    justifyContent: 'center',
  },
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroSubLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 0,
  },
  heroSubText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
  },
  heroValue: {
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  heroValueFixed: {
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: -0.5,
    minWidth: 38,
    textAlign: 'right' as const,
  },
  secondaryValueFixed: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: -0.3,
    minWidth: 30,
    textAlign: 'right' as const,
    flexShrink: 1,
  },
  secondaryLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  heroTrend: {
    fontSize: typography.cardTitle.fontSize,
    marginLeft: spacing.xxs,
  },
  heroLabel: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  // Sparkline - own row, full width
  sparklineRow: {
    marginTop: spacing.xs,
  },
  // Supporting metrics row
  supportingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexWrap: 'wrap',
    gap: spacing.xxs,
  },
  supportingMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  metricLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metricTrend: {
    fontSize: typography.micro.fontSize,
    marginLeft: spacing.xxs,
  },
  metricDivider: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginHorizontal: spacing.xs,
  },
  metricDividerDark: {
    color: darkColors.textSecondary,
  },

  // Text color utilities
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
