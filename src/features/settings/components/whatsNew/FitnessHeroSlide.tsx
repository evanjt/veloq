import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Rect } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/app';
import { ChartCanvas, CurveArea, CurveLine, useChartColors } from '@/shared/charts';
import { colors, darkColors, spacing, layout, typography, opacity, zoneColour } from '@/theme';
import { tourPanelColour } from './tourPanel';
import {
  FORM_ZONE_BOUNDARIES,
  FORM_ZONE_COLORS,
  formZoneTextColor,
  getFormZone,
  type FormZone,
} from '@/features/fitness';
import {
  tourPowerCurve,
  tourTrainingBlock,
  tourZoneShares,
  type TourDay,
} from './fitnessTourPreview';

const BLOCK = tourTrainingBlock();
const LATEST_FORM = BLOCK.at(-1)?.form ?? 0;
const POWER = tourPowerCurve();
const ZONE_SHARES = tourZoneShares();

const LOAD_SERIES = {
  fitness: (d: TourDay) => d.fitness,
  fatigue: (d: TourDay) => d.fatigue,
};
const FORM_SERIES = { form: (d: TourDay) => d.form };
const POWER_SERIES = { watts: (d: { x: number; y: number }) => d.y };
const dayOf = (d: TourDay) => d.x;
const secondsOf = (d: { x: number }) => d.x;

// Zero-based like the fitness chart it mirrors, so fitness keeps its wash.
const LOAD_DOMAIN: [number, number] = [
  0,
  Math.max(...BLOCK.map((d) => Math.max(d.fitness, d.fatigue))) * 1.1,
];
const FORM_DOMAIN: [number, number] = [-35, 30];
const POWER_DOMAIN: [number, number] = [0, Math.max(...POWER.map((p) => p.y)) * 1.05];
const FORM_ZONES: FormZone[] = ['transition', 'fresh', 'greyZone', 'optimal', 'highRisk'];
const PLOT_PADDING = { top: 2, bottom: 2 } as const;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Four small cut-outs of the Fitness tab, drawn with the tab's chart parts on
 * one demo block, and the tab's own lines saying what each number is.
 */
export function FitnessHeroSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const cardColor = tourPanelColour(isDark);
  const titleColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const formZone = getFormZone(LATEST_FORM);

  const card = (testID: string, titleKey: string, body: React.ReactNode, aside?: string) => (
    <View testID={testID} style={[styles.card, { backgroundColor: cardColor }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>{t(titleKey as never)}</Text>
        {aside != null && (
          <Text
            style={[
              styles.cardAside,
              { color: formZone ? formZoneTextColor(formZone, isDark) : titleColor },
            ]}
          >
            {aside}
          </Text>
        )}
      </View>
      <View style={styles.plot}>{body}</View>
    </View>
  );

  const explanations = [
    {
      key: 'fitnessScreen.fitnessDescription',
      name: 'metrics.fitness',
      dot: chartColors.fitness,
    },
    {
      key: 'fitnessScreen.fatigueDescription',
      name: 'metrics.fatigue',
      dot: chartColors.fatigue,
    },
    { key: 'fitnessScreen.formDescription', name: 'metrics.form', dot: FORM_ZONE_COLORS.optimal },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {card(
          'fitness-tour-fitness',
          'fitnessScreen.fitnessAndFatigue',
          <ChartCanvas
            data={BLOCK}
            x={dayOf}
            series={LOAD_SERIES}
            yDomain={LOAD_DOMAIN}
            padding={PLOT_PADDING}
          >
            {({ points, bounds }) => (
              <>
                <CurveArea
                  points={points.fitness}
                  yDomain={LOAD_DOMAIN}
                  y0={bounds.bottom}
                  color={chartColors.fitness}
                  isDark={isDark}
                />
                <CurveLine points={points.fitness} color={chartColors.fitness} strokeWidth={1.5} />
                <CurveLine points={points.fatigue} color={chartColors.fatigue} strokeWidth={1} />
              </>
            )}
          </ChartCanvas>
        )}
        {card(
          'fitness-tour-form',
          'metrics.form',
          <ChartCanvas
            data={BLOCK}
            x={dayOf}
            series={FORM_SERIES}
            yDomain={FORM_DOMAIN}
            padding={PLOT_PADDING}
          >
            {({ points, bounds, yFor }) => (
              <>
                {FORM_ZONES.map((zone) => {
                  const top = Math.max(bounds.top, yFor(FORM_ZONE_BOUNDARIES[zone].max));
                  const bottom = Math.min(bounds.bottom, yFor(FORM_ZONE_BOUNDARIES[zone].min));
                  return (
                    <Rect
                      key={zone}
                      x={bounds.left}
                      y={top}
                      width={bounds.right - bounds.left}
                      height={Math.max(0, bottom - top)}
                      color={FORM_ZONE_COLORS[zone] + (zone === 'greyZone' ? '20' : '30')}
                    />
                  );
                })}
                <CurveLine points={points.form} color={chartColors.formLine} strokeWidth={1.5} />
              </>
            )}
          </ChartCanvas>,
          signed(LATEST_FORM)
        )}
      </View>
      <View style={styles.row}>
        {card(
          'fitness-tour-power-curve',
          'stats.powerCurve',
          <ChartCanvas
            data={POWER}
            x={secondsOf}
            series={POWER_SERIES}
            yDomain={POWER_DOMAIN}
            padding={PLOT_PADDING}
            grid={3}
          >
            {({ points }) => (
              <CurveLine points={points.watts} color={chartColors.powerCurve} strokeWidth={1.5} />
            )}
          </ChartCanvas>
        )}
        {card(
          'fitness-tour-zones',
          'stats.powerZones',
          <View style={styles.zones}>
            {ZONE_SHARES.map(({ zone, percent }) => (
              <View key={zone} style={styles.zoneRow}>
                <Text style={[styles.zoneLabel, { color: zoneColour(zone, isDark, 'text') }]}>
                  {`Z${zone}`}
                </Text>
                <View
                  style={[
                    styles.zoneTrack,
                    {
                      backgroundColor: isDark ? opacity.overlayDark.medium : opacity.overlay.medium,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.zoneBar,
                      { width: `${percent}%`, backgroundColor: zoneColour(zone, isDark, 'fill') },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.explanations}>
        {explanations.map((line) => (
          <View key={line.key} style={styles.explanationRow}>
            <View style={[styles.dot, { backgroundColor: line.dot }]} />
            <Text style={[styles.explanation, { color: mutedColor }]}>
              <Text style={[styles.explanationName, { color: titleColor }]}>
                {t(line.name as never)}
              </Text>{' '}
              {t(line.key as never)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: layout.borderRadiusMd,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.badge,
    flexShrink: 1,
  },
  cardAside: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
  },
  plot: {
    height: 52,
  },
  zones: {
    flex: 1,
    justifyContent: 'space-between',
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  zoneLabel: {
    width: 18,
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
  },
  zoneTrack: {
    flex: 1,
    height: 6,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  zoneBar: {
    height: '100%',
    borderRadius: layout.borderRadiusFull,
  },
  explanations: {
    gap: spacing.xs,
  },
  explanationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    marginTop: spacing.xs,
    borderRadius: layout.borderRadiusFull,
  },
  explanation: {
    ...typography.caption,
    flex: 1,
  },
  explanationName: {
    fontWeight: '600',
  },
});
