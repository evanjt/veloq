/**
 * The five staged sliders. Pure local values: moving a slider changes nothing
 * outside this panel until the caller runs a preview or keeps the result.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import type { PreviewParams } from '../../../../../modules/veloqrs/src/delegates/preview';

interface PreviewParamPanelProps {
  params: PreviewParams;
  onChange: (params: PreviewParams) => void;
  disabled?: boolean;
}

export function PreviewParamPanel({ params, onChange, disabled }: PreviewParamPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const set = (key: keyof PreviewParams) => (value: number) =>
    onChange({ ...params, [key]: value });

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="preview-param-panel"
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      <ParamRow
        label={t('settings.sectionProximity', { meters: params.proximityThreshold })}
        value={params.proximityThreshold}
        min={25}
        max={300}
        step={25}
        onChange={set('proximityThreshold')}
        isDark={isDark}
      />
      <ParamRow
        label={t('settings.sectionMinLength', { meters: params.minSectionLength })}
        value={params.minSectionLength}
        min={50}
        max={2000}
        step={50}
        onChange={set('minSectionLength')}
        isDark={isDark}
      />
      <ParamRow
        label={t('settings.sectionMaxLength', { meters: params.maxSectionLength })}
        value={params.maxSectionLength}
        min={2000}
        max={200000}
        step={1000}
        onChange={set('maxSectionLength')}
        isDark={isDark}
      />
      <ParamRow
        label={t('settings.sectionMinActivities', { count: params.minActivities })}
        value={params.minActivities}
        min={2}
        max={10}
        step={1}
        onChange={set('minActivities')}
        isDark={isDark}
      />
      <ParamRow
        label={t('settings.sectionSameTraffic', {
          value: params.divergenceThreshold.toFixed(2),
        })}
        value={params.divergenceThreshold}
        min={0.05}
        max={0.5}
        step={0.05}
        onChange={set('divergenceThreshold')}
        isDark={isDark}
      />
    </View>
  );
}

function ParamRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  isDark,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  isDark: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? darkColors.inputTrack : colors.inputTrack;
  return (
    <View style={styles.paramRow}>
      <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={onChange}
        minimumTrackTintColor={brand.tealLight}
        maximumTrackTintColor={trackBg}
        thumbTintColor={brand.tealLight}
      />
    </View>
  );
}

// Five rows sit under the map and nothing scrolls, so the card takes whatever
// the fixed chrome leaves and the rows divide it evenly rather than each
// claiming a height the screen may not have. A short phone gets thin sliders,
// which is worse than a tall phone and much better than a Keep button pushed
// off the bottom.
const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  paramRow: { flex: 1, justifyContent: 'center' },
  paramLabel: {
    ...typography.caption,
  },
  slider: {
    width: '100%',
    flex: 1,
  },
});
