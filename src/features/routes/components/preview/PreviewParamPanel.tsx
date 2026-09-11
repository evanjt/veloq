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
 * The card scrolls, and it is the only thing on the screen that does. A run
 * disables the sliders one by one rather than the card, or the rows below the
 * fold would be unreachable exactly when the diff strip squeezes the column.
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { formatDistance } from '@/shared/format/format';
import { useTheme } from '@/shared/app';
import { colors, darkColors, brand, opacity, spacing, layout, typography } from '@/theme';
import {
  DETECTION_PARAM_RANGES,
  DETECTION_PRESETS,
  DETECTION_PRESET_NAMES,
  isPastClamp,
  parseParamInput,
  presetOf,
  type DetectionParamKey,
  type DetectionPresetName,
} from '../../lib/detectionParams';
import type { PreviewParams } from '../../../../../modules/veloqrs/src/delegates/preview';

interface PreviewParamPanelProps {
  params: PreviewParams;
  onChange: (params: PreviewParams) => void;
  disabled?: boolean;
}

/** Which row the editor is open over, and what has been typed into it. */
interface Editing {
  key: DetectionParamKey;
  label: string;
  text: string;
}

export function PreviewParamPanel({ params, onChange, disabled }: PreviewParamPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const [editing, setEditing] = useState<Editing | null>(null);

  const set = (key: keyof PreviewParams) => (value: number) =>
    onChange({ ...params, [key]: value });

  const open = (key: DetectionParamKey, label: string) => () => {
    if (disabled) return;
    setEditing({ key, label, text: String(params[key]) });
  };

  const save = () => {
    if (!editing) return;
    const value = parseParamInput(editing.key, editing.text);
    // A refusal leaves the editor open with what was typed still in it: the
    // athlete is one character from a value that works, and closing on them
    // would throw the rest of the entry away.
    if (value === null) return;
    onChange({ ...params, [editing.key]: value });
    setEditing(null);
  };

  const active = presetOf(params);

  const row = (key: DetectionParamKey, label: string) => (
    <ParamRow
      paramKey={key}
      label={label}
      value={params[key]}
      onChange={set(key)}
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
      pointerEvents="box-none"
    >
      {row(
        'proximityThreshold',
        t('settings.sectionProximity', { distance: formatDistance(params.proximityThreshold) })
      )}
      {row(
        'minSectionLength',
        t('settings.sectionMinLength', { distance: formatDistance(params.minSectionLength) })
      )}
      {row(
        'maxSectionLength',
        t('settings.sectionMaxLength', { distance: formatDistance(params.maxSectionLength) })
      )}
      {row('minActivities', t('settings.sectionMinActivities', { count: params.minActivities }))}
      {row(
        'divergenceThreshold',
        t('settings.sectionSameTraffic', { value: params.divergenceThreshold.toFixed(2) })
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
          <PresetChip
            key={name}
            name={name}
            label={t(PRESET_LABELS[name])}
            active={active === name}
            onPress={() => onChange({ ...DETECTION_PRESETS[name] })}
            isDark={isDark}
            disabled={disabled}
          />
        ))}
      </View>

      {editing !== null && (
        <ParamEditor
          editing={editing}
          onText={(text) => setEditing({ ...editing, text })}
          onSave={save}
          onCancel={() => setEditing(null)}
          isDark={isDark}
        />
      )}
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
  value,
  onChange,
  onEdit,
  isDark,
  disabled,
}: {
  paramKey: DetectionParamKey;
  label: string;
  value: number;
  onChange: (v: number) => void;
  onEdit: () => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? darkColors.inputTrack : colors.inputTrack;
  const { min, max, step } = DETECTION_PARAM_RANGES[paramKey];
  return (
    <View style={styles.paramRow}>
      <Pressable
        onPress={onEdit}
        disabled={disabled}
        testID={`param-edit-${paramKey}`}
        accessibilityRole="button"
      >
        <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
      </Pressable>
      <Slider
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
    </View>
  );
}

function PresetChip({
  name,
  label,
  active,
  onPress,
  isDark,
  disabled,
}: {
  name: DetectionPresetName;
  label: string;
  active: boolean;
  onPress: () => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const border = isDark ? darkColors.border : colors.border;
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={`preset-${name}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: active }}
      style={[
        styles.presetChip,
        { borderColor: active ? brand.tealLight : border },
        disabled && styles.presetChipDisabled,
      ]}
    >
      <Text style={[styles.presetChipLabel, { color: active ? brand.tealLight : txt }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ParamEditor({
  editing,
  onText,
  onSave,
  onCancel,
  isDark,
}: {
  editing: Editing;
  onText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const { min, max } = DETECTION_PARAM_RANGES[editing.key];
  const parsed = parseParamInput(editing.key, editing.text);
  const pastClamp = parsed !== null && isPastClamp(editing.key, parsed);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} testID="param-editor">
      <Pressable style={styles.scrim} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: textPrimary }]}>{editing.label}</Text>
          <TextInput
            testID="param-editor-input"
            value={editing.text}
            onChangeText={onText}
            keyboardType="numeric"
            autoFocus
            selectTextOnFocus
            style={[styles.sheetInput, { color: textPrimary, borderColor: border }]}
          />
          <Text style={[styles.sheetNote, { color: textSecondary }]}>
            {t('settings.sectionParamRange', { min, max })}
          </Text>
          {pastClamp && (
            <Text
              testID="param-editor-clamp-note"
              style={[styles.sheetNote, { color: textSecondary }]}
            >
              {t('settings.sectionParamPastClamp')}
            </Text>
          )}
          <View style={styles.sheetActions}>
            <Pressable onPress={onCancel} testID="param-editor-cancel" accessibilityRole="button">
              <Text style={[styles.sheetAction, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable onPress={onSave} testID="param-editor-save" accessibilityRole="button">
              <Text style={[styles.sheetAction, { color: brand.tealLight }]}>
                {t('common.save')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  presetChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetChipDisabled: { opacity: 0.4 },
  presetChipLabel: {
    ...typography.caption,
  },
  scrim: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: opacity.overlay.scrim,
  },
  sheet: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sheetTitle: {
    ...typography.bodyMedium,
  },
  sheetInput: {
    ...typography.body,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sheetNote: {
    ...typography.caption,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  sheetAction: {
    ...typography.bodyMedium,
  },
});
