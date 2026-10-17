/**
 * The two route-grouping knobs: a slider each over the range the grouper has
 * been run over, and a numeric editor past it for an athlete who wants to try
 * something outside it.
 *
 * No presets. The three-stop ladder that used to collapse these two numbers
 * into one was deleted deliberately: they are two different questions, and a
 * single axis cannot express "same roads, different start".
 *
 * The labels say what the number does to the athlete's rides rather than
 * naming the parameter, so the control is readable without knowing what the
 * grouper calls it.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { useTheme } from '@/shared/app/useTheme';
import { formatDistance } from '@/shared/format/format';
import { pressable, pressRipple } from '@/shared/ui';
import { brand, colors, darkColors, iconSize, layout, spacing, typography, stroke } from '@/theme';
import {
  GROUPING_PARAM_RANGES,
  isPastGroupingRange,
  type GroupingParamKey,
  type GroupingParams,
} from '../../lib/groupingParams';
import type { ParamEditorSheetInput } from '../../lib/paramEditorSheet';
import { distanceEditorUnit, toEditorText, type EditorUnit } from '../../lib/paramUnits';

interface GroupingParamPanelProps {
  params: GroupingParams;
  onChange: (params: GroupingParams) => void;
  disabled?: boolean;
}

/** The unit a parameter is edited in, null for the match percentage. */
function editorUnitOf(key: GroupingParamKey, isMetric: boolean): EditorUnit | null {
  return key === 'endpointThreshold' ? distanceEditorUnit(isMetric, false) : null;
}

export function GroupingParamPanel({
  params,
  onChange,
  disabled = false,
}: GroupingParamPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const openSheet = useSheetOpener();

  const set = (key: GroupingParamKey) => (value: number) => onChange({ ...params, [key]: value });

  const open = (key: GroupingParamKey, label: string) => async () => {
    if (disabled) return;
    const unit = editorUnitOf(key, isMetric);
    const initial = toEditorText(params[key], unit);
    const input: ParamEditorSheetInput = {
      kind: 'grouping',
      key,
      label,
      initial,
      unit,
    };
    const result = await openSheet<ParamEditorSheetInput, number>('sheets/param-editor', input);
    if (result.kind === 'selected' && result.value !== params[key]) {
      onChange({ ...params, [key]: result.value });
    }
  };

  const matchLabel = t('settings.groupingMatchShare', {
    percent: params.minMatchPercentage,
  });
  const endsApart = formatDistance(params.endpointThreshold, isMetric);
  const endsLabel = t('settings.groupingEndsApart', { distance: endsApart });

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="grouping-param-panel"
    >
      <ParamRow
        paramKey="minMatchPercentage"
        label={matchLabel}
        valueText={`${params.minMatchPercentage}%`}
        value={params.minMatchPercentage}
        onChange={set('minMatchPercentage')}
        onEdit={open('minMatchPercentage', matchLabel)}
        isDark={isDark}
        disabled={disabled}
      />
      <ParamRow
        paramKey="endpointThreshold"
        label={endsLabel}
        valueText={endsApart}
        value={params.endpointThreshold}
        onChange={set('endpointThreshold')}
        onEdit={open('endpointThreshold', endsLabel)}
        isDark={isDark}
        disabled={disabled}
      />
    </View>
  );
}

function ParamRow({
  paramKey,
  label,
  valueText,
  value,
  onChange,
  onEdit,
  isDark,
  disabled = false,
}: {
  paramKey: GroupingParamKey;
  label: string;
  /** The value as the athlete reads it, in their unit, for a screen reader. */
  valueText: string;
  value: number;
  onChange: (v: number) => void;
  onEdit: () => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? darkColors.inputTrack : colors.inputTrack;
  const { t } = useTranslation();
  const { min, max, step } = GROUPING_PARAM_RANGES[paramKey];
  return (
    <View style={styles.paramRow}>
      <Pressable
        onPress={onEdit}
        disabled={disabled}
        testID={`grouping-edit-${paramKey}`}
        accessibilityRole="button"
        accessibilityHint={t('settings.sectionParamEditHint')}
        style={pressable(styles.editRow)}
        android_ripple={pressRipple}
      >
        <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
        <MaterialCommunityIcons name="pencil" size={iconSize.sm} color={txt} />
      </Pressable>
      <Slider
        testID={`grouping-slider-${paramKey}`}
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText }}
        style={styles.slider}
        disabled={disabled}
        value={value}
        // A typed value outside the tested range is still the value in force,
        // so the slider reaches it rather than drawing its own end instead.
        minimumValue={Math.min(min, value)}
        maximumValue={Math.max(max, value)}
        step={step}
        onValueChange={onChange}
        minimumTrackTintColor={brand.tealLight}
        maximumTrackTintColor={trackBg}
        thumbTintColor={brand.tealLight}
      />
      {isPastGroupingRange(paramKey, value) && (
        <Text
          testID={`grouping-range-note-${paramKey}`}
          style={[styles.paramLabel, { color: txt }]}
        >
          {t('settings.sectionParamPastRange')}
        </Text>
      )}
    </View>
  );
}

const PARAM_ROW_MIN_HEIGHT = layout.minTapTarget;

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: stroke.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  paramRow: { justifyContent: 'center', minHeight: PARAM_ROW_MIN_HEIGHT },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  paramLabel: { ...typography.caption, flexShrink: 1 },
  slider: { width: '100%' },
});
