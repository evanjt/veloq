/**
 * The five staged sliders, three presets and a numeric editor. Pure local
 * values: nothing here changes anything outside the panel until the caller
 * runs a preview or keeps the result.
 *
 * The three distance captions all read through `formatDistance`, so the ceiling
 * reads as kilometres rather than as 200000 metres and the panel has one
 * spacing rule instead of a per-caption one.
 *
 * The sliders cover the range the detector has been run over and no further.
 * Anything outside it is typed on the caption, because a slider that reaches a
 * value the detector stops distinguishing is a control that moves and does
 * nothing. The editor says so where the detector has such a point, and the
 * slider grows to whatever was typed so it never draws a value that is not the
 * one in force.
 *
 * `onChange` follows every movement and `onCommit` only a settled value: a
 * slider released, a preset chosen or a value typed. A drag is a stream of
 * values nobody has chosen yet, so only the second is worth a run.
 *
 * The card scrolls, and it is the only thing on the screen that does. A
 * disabled panel disables the sliders one by one rather than the card, or the
 * rows below the fold would be unreachable exactly when the diff strip
 * squeezes the column.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import type { PreviewParams } from 'veloqrs';

import { useMetricSystem, useTheme } from '@/shared/app';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { formatDistance } from '@/shared/format/format';
import { ToggleButton, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
  themePalette,
} from '@/theme';
import {
  DETECTION_PARAM_RANGES,
  DETECTION_PRESETS,
  DETECTION_PRESET_NAMES,
  isPastTestedRange,
  presetOf,
  type DetectionParamKey,
  type DetectionPresetName,
} from '../../lib/detectionParams';
import type { ParamEditorSheetInput } from '../../lib/paramEditorSheet';
import { distanceEditorUnit, toEditorText, type EditorUnit } from '../../lib/paramUnits';
import { formatDecimal } from '@/shared/format';

interface PreviewParamPanelProps {
  params: PreviewParams;
  onChange: (params: PreviewParams) => void;
  onCommit?: ((params: PreviewParams) => void) | undefined;
  disabled?: boolean | undefined;
}

/** The unit a parameter is edited in, null for a count or a ratio. */
function editorUnitOf(key: DetectionParamKey, isMetric: boolean): EditorUnit | null {
  if (key === 'maxSectionLength') return distanceEditorUnit(isMetric, true);
  if (key === 'proximityThreshold' || key === 'minSectionLength') {
    return distanceEditorUnit(isMetric, false);
  }
  return null;
}

export function PreviewParamPanel({
  params,
  onChange,
  onCommit,
  disabled = false,
}: PreviewParamPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const openSheet = useSheetOpener();

  const set = (key: keyof PreviewParams) => (value: number) =>
    onChange({ ...params, [key]: value });
  const settle = (next: PreviewParams) => {
    onChange(next);
    onCommit?.(next);
  };
  const release = (key: keyof PreviewParams) => (value: number) =>
    settle({ ...params, [key]: value });

  const open = (key: DetectionParamKey, label: string) => async () => {
    if (disabled) return;
    const unit = editorUnitOf(key, isMetric);
    const initial = toEditorText(params[key], unit);
    const input: ParamEditorSheetInput = {
      kind: 'param',
      key,
      label,
      initial,
      unit,
    };
    const result = await openSheet<ParamEditorSheetInput, number>('sheets/param-editor', input);
    if (result.kind === 'selected' && result.value !== params[key]) {
      settle({ ...params, [key]: result.value });
    }
  };

  const active = presetOf(params);

  const distance = (key: DetectionParamKey) => formatDistance(params[key], isMetric);
  const row = (key: DetectionParamKey, label: string, valueText: string) => (
    <ParamRow
      paramKey={key}
      label={label}
      valueText={valueText}
      value={params[key]}
      onChange={set(key)}
      onRelease={release(key)}
      onEdit={open(key, label)}
      isDark={isDark}
      disabled={disabled}
    />
  );

  return (
    <ScrollView
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      contentContainerStyle={styles.cardContent}
      testID="preview-param-panel"
    >
      {row(
        'proximityThreshold',
        t('settings.sectionProximity', { distance: distance('proximityThreshold') }),
        distance('proximityThreshold')
      )}
      {row(
        'minSectionLength',
        t('settings.sectionMinLength', { distance: distance('minSectionLength') }),
        distance('minSectionLength')
      )}
      {row(
        'maxSectionLength',
        t('settings.sectionMaxLength', { distance: distance('maxSectionLength') }),
        distance('maxSectionLength')
      )}
      {row(
        'minActivities',
        t('settings.sectionMinActivities', { count: params.minActivities }),
        String(params.minActivities)
      )}
      {row(
        'divergenceThreshold',
        t('settings.sectionSameTraffic', { value: formatDecimal(params.divergenceThreshold, 2) }),
        formatDecimal(params.divergenceThreshold, 2)
      )}

      <View style={styles.presetRow}>
        <Text
          style={[
            styles.presetLabel,
            { color: isDark ? darkColors.textSecondary : colors.textSecondary },
          ]}
        >
          {t('settings.sectionPresets')}
        </Text>
        {DETECTION_PRESET_NAMES.map((name) => (
          <ToggleButton
            key={name}
            testID={`preset-${name}`}
            label={t(PRESET_LABELS[name])}
            selected={active === name}
            onPress={() => settle({ ...DETECTION_PRESETS[name] })}
            disabled={disabled}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const PRESET_LABELS = {
  default: 'settings.sectionPresetDefault',
  strict: 'settings.sectionPresetStrict',
  relaxed: 'settings.sectionPresetRelaxed',
} as const satisfies Record<DetectionPresetName, string>;

function ParamRow({
  paramKey,
  label,
  valueText,
  value,
  onChange,
  onRelease,
  onEdit,
  isDark,
  disabled = false,
}: {
  paramKey: DetectionParamKey;
  label: string;
  /** The value as the athlete reads it, in their unit, for a screen reader. */
  valueText: string;
  value: number;
  onChange: (v: number) => void;
  onRelease: (v: number) => void;
  onEdit: () => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? darkColors.track : colors.track;
  const { t } = useTranslation();
  const { min, max, step } = DETECTION_PARAM_RANGES[paramKey];
  return (
    <View style={styles.paramRow}>
      <PressTarget
        onPress={onEdit}
        disabled={disabled}
        testID={`param-edit-${paramKey}`}
        accessibilityRole="button"
        accessibilityHint={t('settings.sectionParamEditHint')}
        style={styles.editRow}
      >
        <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
        <Icon name="pencil" size={iconSize.sm} color={txt} />
      </PressTarget>
      <Slider
        testID={`param-slider-${paramKey}`}
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
        onSlidingComplete={onRelease}
        minimumTrackTintColor={themePalette(isDark).actionPrimary}
        maximumTrackTintColor={trackBg}
        thumbTintColor={themePalette(isDark).actionPrimary}
      />
      {isPastTestedRange(paramKey, value) && (
        <Text testID={`param-range-note-${paramKey}`} style={[styles.paramLabel, { color: txt }]}>
          {t('settings.sectionParamPastRange')}
        </Text>
      )}
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
    borderWidth: stroke.hairline,
  },
  cardContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  paramRow: {
    flex: 1,
    justifyContent: 'center',
    minHeight: PARAM_ROW_MIN_HEIGHT,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  paramLabel: {
    ...typography.caption,
    flexShrink: 1,
  },
  slider: {
    width: '100%',
    flex: 1,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    minHeight: PARAM_ROW_MIN_HEIGHT,
  },
  presetLabel: {
    ...typography.caption,
  },
});
