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

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { formatDistance } from '@/shared/format/format';
import { useTheme } from '@/shared/app/useTheme';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { colors, darkColors, brand, opacity, spacing, layout, typography } from '@/theme';
import {
  GROUPING_PARAM_RANGES,
  isPastGroupingRange,
  parseGroupingInput,
  type GroupingParamKey,
  type GroupingParams,
} from '../../lib/groupingParams';
import {
  distanceEditorUnit,
  fromEditorValue,
  toEditorText,
  type EditorUnit,
} from '../../lib/paramUnits';
import { pressable, pressRipple } from '@/shared/ui';

interface GroupingParamPanelProps {
  params: GroupingParams;
  onChange: (params: GroupingParams) => void;
  disabled?: boolean;
}

/** Which row the editor is open over, and what has been typed into it. */
interface Editing {
  key: GroupingParamKey;
  label: string;
  text: string;
  /** What the editor opened with, so an untouched save cannot round the stored metres. */
  initial: string;
  unit: EditorUnit | null;
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
  const [editing, setEditing] = useState<Editing | null>(null);

  const set = (key: GroupingParamKey) => (value: number) => onChange({ ...params, [key]: value });

  const open = (key: GroupingParamKey, label: string) => () => {
    if (disabled) return;
    const unit = editorUnitOf(key, isMetric);
    const text = toEditorText(params[key], unit);
    setEditing({ key, label, text, initial: text, unit });
  };

  const save = () => {
    if (!editing) return;
    if (editing.text === editing.initial) {
      setEditing(null);
      return;
    }
    const typed = parseGroupingInput(editing.key, editing.text);
    // A refusal leaves the editor open with what was typed still in it: the
    // athlete is one character from a value that works.
    if (typed === null) return;
    const value = fromEditorValue(typed, editing.unit);
    if (value <= 0) return;
    onChange({ ...params, [editing.key]: value });
    setEditing(null);
  };

  const matchLabel = t('settings.groupingMatchShare', { percent: params.minMatchPercentage });
  const endsLabel = t('settings.groupingEndsApart', {
    distance: formatDistance(params.endpointThreshold, isMetric),
  });

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="grouping-param-panel"
    >
      <ParamRow
        paramKey="minMatchPercentage"
        label={matchLabel}
        value={params.minMatchPercentage}
        onChange={set('minMatchPercentage')}
        onEdit={open('minMatchPercentage', matchLabel)}
        isDark={isDark}
        disabled={disabled}
      />
      <ParamRow
        paramKey="endpointThreshold"
        label={endsLabel}
        value={params.endpointThreshold}
        onChange={set('endpointThreshold')}
        onEdit={open('endpointThreshold', endsLabel)}
        isDark={isDark}
        disabled={disabled}
      />

      {editing !== null && (
        <ParamEditor
          editing={editing}
          onText={(text) => setEditing({ ...editing, text })}
          onSave={save}
          onCancel={() => setEditing(null)}
          isDark={isDark}
        />
      )}
    </View>
  );
}

function ParamRow({
  paramKey,
  label,
  value,
  onChange,
  onEdit,
  isDark,
  disabled = false,
}: {
  paramKey: GroupingParamKey;
  label: string;
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
        style={pressable()}
        android_ripple={pressRipple}
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
  const { min, max } = GROUPING_PARAM_RANGES[editing.key];
  const parsed = parseGroupingInput(editing.key, editing.text);
  const pastRange =
    parsed !== null && isPastGroupingRange(editing.key, fromEditorValue(parsed, editing.unit));
  const bound = (metres: number) =>
    editing.unit
      ? `${toEditorText(metres, editing.unit)} ${editing.unit.label}`
      : toEditorText(metres, null);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} testID="grouping-editor">
      <Pressable style={pressable(styles.scrim)} android_ripple={pressRipple} onPress={onCancel}>
        <Pressable
          style={pressable([styles.sheet, { backgroundColor: surface, borderColor: border }])}
          android_ripple={pressRipple}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: textPrimary }]}>{editing.label}</Text>
          <TextInput
            testID="grouping-editor-input"
            value={editing.text}
            onChangeText={onText}
            keyboardType="numeric"
            autoFocus
            selectTextOnFocus
            style={[styles.sheetInput, { color: textPrimary, borderColor: border }]}
          />
          <Text style={[styles.sheetNote, { color: textSecondary }]}>
            {t('settings.sectionParamRange', { min: bound(min), max: bound(max) })}
          </Text>
          {pastRange && (
            <Text
              testID="grouping-editor-range-note"
              style={[styles.sheetNote, { color: textSecondary }]}
            >
              {t('settings.sectionParamPastRange')}
            </Text>
          )}
          <View style={styles.sheetActions}>
            <Pressable
              onPress={onCancel}
              testID="grouping-editor-cancel"
              accessibilityRole="button"
              style={pressable()}
              android_ripple={pressRipple}
            >
              <Text style={[styles.sheetAction, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              testID="grouping-editor-save"
              accessibilityRole="button"
              style={pressable()}
              android_ripple={pressRipple}
            >
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

const PARAM_ROW_MIN_HEIGHT = layout.minTapTarget;

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  paramRow: { justifyContent: 'center', minHeight: PARAM_ROW_MIN_HEIGHT },
  paramLabel: { ...typography.caption },
  slider: { width: '100%' },
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
  sheetTitle: { ...typography.bodyMedium },
  sheetInput: {
    ...typography.body,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sheetNote: { ...typography.caption },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  sheetAction: { ...typography.bodyMedium },
});
