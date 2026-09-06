/**
 * The five staged sliders. Pure local values: moving a slider changes nothing
 * outside this panel until the caller runs a preview or keeps the result.
 *
 * The three distance captions all read through `formatDistance`, so the ceiling
 * reads as kilometres rather than as 200000 metres and the panel has one
 * spacing rule instead of a per-caption one.
 *
 * The card scrolls, and it is the only thing on the screen that does. A run
 * disables the sliders one by one rather than the card, or the rows below the
 * fold would be unreachable exactly when the diff strip squeezes the column.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { formatDistance } from '@/shared/format/format';
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
    <ScrollView
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      contentContainerStyle={styles.cardContent}
      testID="preview-param-panel"
      pointerEvents="box-none"
    >
      <ParamRow
        label={t('settings.sectionProximity', {
          distance: formatDistance(params.proximityThreshold),
        })}
        value={params.proximityThreshold}
        min={25}
        max={300}
        step={25}
        onChange={set('proximityThreshold')}
        isDark={isDark}
        disabled={disabled}
      />
      <ParamRow
        label={t('settings.sectionMinLength', {
          distance: formatDistance(params.minSectionLength),
        })}
        value={params.minSectionLength}
        min={50}
        max={2000}
        step={50}
        onChange={set('minSectionLength')}
        isDark={isDark}
        disabled={disabled}
      />
      <ParamRow
        label={t('settings.sectionMaxLength', {
          distance: formatDistance(params.maxSectionLength),
        })}
        value={params.maxSectionLength}
        min={2000}
        max={200000}
        step={1000}
        onChange={set('maxSectionLength')}
        isDark={isDark}
        disabled={disabled}
      />
      <ParamRow
        label={t('settings.sectionMinActivities', { count: params.minActivities })}
        value={params.minActivities}
        min={2}
        max={10}
        step={1}
        onChange={set('minActivities')}
        isDark={isDark}
        disabled={disabled}
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
        disabled={disabled}
      />
    </ScrollView>
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
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? darkColors.inputTrack : colors.inputTrack;
  return (
    <View style={styles.paramRow}>
      <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
      <Slider
        style={styles.slider}
        disabled={disabled}
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

// The card takes whatever the fixed chrome leaves, and `flexGrow: 1` on the
// content lets the five rows divide that up on a tall screen. A short one
// cannot give each row its tap target, so the card scrolls instead of drawing
// the captions over the sliders. The padding and the gap belong on the content
// container: on the ScrollView itself they do not apply.
const PARAM_ROW_MIN_HEIGHT = layout.minTapTarget;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  paramRow: { flex: 1, justifyContent: 'center', minHeight: PARAM_ROW_MIN_HEIGHT },
  paramLabel: {
    ...typography.caption,
  },
  slider: {
    width: '100%',
    flex: 1,
  },
});
