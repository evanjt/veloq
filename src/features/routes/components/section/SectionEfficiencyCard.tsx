/**
 * Aerobic efficiency on one section: heart rate per unit of speed across every matched
 * effort that carried both signals, oldest to newest. The engine computes
 * the series and the regression, this only plots them.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui';
import { polylineSvgPath, type XY } from '@/shared/charts';
import { colors, darkColors, spacing, typography, colorWithOpacity, verdictColor } from '@/theme';
import { EfficiencyDirection, type EfficiencyPoint, type EfficiencyTrend } from 'veloqrs';
import { useSectionEfficiencyTrend } from '@/features/routes/hooks/useSectionEfficiencyTrend';
import { engineErrorKey } from '@/shared/native/engineError';

const CHART_HEIGHT = 56;
const PAD = 6;

/**
 * Scale a ratio series onto the canvas. A lower ratio is less cardiac cost
 * for the same pace, so it sits higher. A flat series has no range to scale
 * against and is drawn down the middle.
 */
export function efficiencySeriesVertices(
  points: EfficiencyPoint[],
  width: number,
  height: number
): XY[] {
  if (points.length === 0) return [];

  const ratios = points.map((p) => p.hrPaceRatio);
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const range = max - min;
  const w = width - PAD * 2;
  const h = height - PAD * 2;

  return ratios.map((ratio, i) => ({
    x: PAD + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w),
    y: range === 0 ? PAD + h / 2 : PAD + ((ratio - min) / range) * h,
  }));
}

export interface SectionEfficiencyCardProps {
  sectionId: string;
  /** The sport on screen, whose efforts the trend is taken over. */
  sportType?: string | null | undefined;
  isDark: boolean;
  /** Canvas width. The card is full-bleed inside its own padding. */
  width?: number | undefined;
  /** The screen bundle's trend, so the card makes no engine call of its own. */
  bundledTrend?: EfficiencyTrend | null | undefined;
}

export function SectionEfficiencyCard({
  sectionId,
  sportType,
  isDark,
  width = 280,
  bundledTrend,
}: SectionEfficiencyCardProps) {
  const { t } = useTranslation();
  const { trend, error } = useSectionEfficiencyTrend(sectionId, sportType, bundledTrend);

  if (error !== undefined) {
    return (
      <Text
        testID="section-efficiency-failure"
        style={[styles.caption, isDark && styles.captionDark]}
      >
        {t(engineErrorKey(error, 'engine.failure.database'))}
      </Text>
    );
  }
  if (!trend) return null;

  const vertices = efficiencySeriesVertices(trend.points, width, CHART_HEIGHT);
  const linePath = Skia.Path.MakeFromSVGString(polylineSvgPath(vertices));
  const hrChange = Math.round(trend.hrChangeBpm);
  const signedHrChange = hrChange > 0 ? `+${hrChange}` : `${hrChange}`;
  const lineColor =
    trend.direction === EfficiencyDirection.Improving
      ? verdictColor('positive', isDark)
      : colors.textSecondary;

  return (
    <Card
      variant="flat"
      testID="section-efficiency-card"
      accessibilityRole="summary"
      style={{ gap: spacing.xs }}
    >
      <Text style={[styles.heading, isDark && styles.headingDark]}>
        {t('sections.aerobicEfficiency')}
      </Text>
      <Text testID="section-efficiency-detail" style={[styles.detail, isDark && styles.detailDark]}>
        {t('sections.aerobicEfficiencyDetail', {
          efforts: trend.effortCount,
          hrChange: signedHrChange,
        })}
      </Text>

      <Canvas testID="section-efficiency-chart" style={{ width, height: CHART_HEIGHT }}>
        {linePath ? (
          <Path path={linePath} color={lineColor} style="stroke" strokeWidth={1.5} />
        ) : null}
        {vertices.map((vertex, i) => (
          <Circle
            key={`eff-${i}`}
            cx={vertex.x}
            cy={vertex.y}
            r={2.5}
            color={colorWithOpacity(lineColor, 0.7)}
          />
        ))}
      </Canvas>

      <Text style={[styles.caption, isDark && styles.captionDark]}>
        {t('sections.aerobicEfficiencyCaption')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  headingDark: {
    color: darkColors.textPrimary,
  },
  detail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captionDark: {
    color: darkColors.textSecondary,
  },
});
