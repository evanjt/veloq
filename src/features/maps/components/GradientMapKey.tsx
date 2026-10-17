/**
 * The key to the activity line while it is coloured by gradient: the base map's
 * seven diverging steps, one per grade band, with gradients ticked where they
 * fall along it.
 */

import React from 'react';
import { Text } from 'react-native-paper';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, typography } from '@/theme';
import {
  GRADE_BANDS,
  GRADIENT_KEY_TICKS,
  gradeStep,
  gradeStepTokenColour,
} from '../lib/gradientLineColor';
import type { MapStyleType } from './mapStyles';
import { MapKey, MapKeyRamp } from './MapKey';

/**
 * Where a gradient falls along the ramp of equal steps: a band's edge for an
 * edge value, the middle of the flat band for 0.
 */
const share = (percent: number) => {
  const index = GRADE_BANDS.findIndex((band) => band.step === gradeStep(percent));
  const onEdge = GRADE_BANDS.some((band) => band.upTo === percent);
  const offset = percent === 0 || !onEdge ? 0.5 : percent < 0 ? 0 : 1;
  return (index + offset) / GRADE_BANDS.length;
};

export function GradientMapKey({
  isDark,
  mapStyle,
  top,
}: {
  isDark: boolean;
  mapStyle: MapStyleType;
  top: number;
}) {
  const { t } = useTranslation();
  const ramp = GRADE_BANDS.map((band) => gradeStepTokenColour(band.step, mapStyle));
  const ticks = GRADIENT_KEY_TICKS.map((percent) => ({
    at: share(percent),
    label: t('maps.gradientTick', { value: percent > 0 ? `+${percent}` : `${percent}` }),
  }));

  return (
    <MapKey isDark={isDark} style={{ top }} testID="activity-map-gradient-key">
      <Text style={[styles.caption, isDark && styles.captionDark]}>{t('chartTypes.grade')}</Text>
      <MapKeyRamp ramp={ramp} ticks={ticks} isDark={isDark} />
    </MapKey>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...typography.label,
    color: colors.textPrimary,
  },
  captionDark: {
    color: darkColors.textPrimary,
  },
});
