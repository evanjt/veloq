/**
 * The key to the activity line while it is coloured by gradient: the scale as a
 * ramp with its gradients ticked where they fall along it.
 */

import React from 'react';
import { Text } from 'react-native-paper';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, typography } from '@/theme';
import { GRADIENT_KEY_TICKS, gradientToColor } from '../lib/gradientLineColor';
import { MapKey, MapKeyRamp } from './MapKey';

/** The span of gradient the ramp shows, in percent. Steeper ground takes the end colour. */
const RAMP_FROM = -20;
const RAMP_TO = 20;
const RAMP_STEPS = 17;

const share = (percent: number) => (percent - RAMP_FROM) / (RAMP_TO - RAMP_FROM);

export function GradientMapKey({ isDark, top }: { isDark: boolean; top: number }) {
  const { t } = useTranslation();
  const ramp = Array.from({ length: RAMP_STEPS }, (_, i) =>
    gradientToColor(RAMP_FROM + ((RAMP_TO - RAMP_FROM) * i) / (RAMP_STEPS - 1))
  );
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
