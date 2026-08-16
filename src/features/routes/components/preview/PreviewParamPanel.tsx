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
        max={20000}
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

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  paramRow: { gap: 2 },
  paramLabel: {
    ...typography.bodySmall,
  },
  slider: {
    width: '100%',
    height: 36,
  },
});
