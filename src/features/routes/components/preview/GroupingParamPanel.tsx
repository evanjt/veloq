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
import { colors, darkColors, brand, opacity, spacing, layout, typography } from '@/theme';
import {
  GROUPING_PARAM_RANGES,
  parseGroupingInput,
  type GroupingParamKey,
  type GroupingParams,
} from '../../lib/groupingParams';

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
}

export function GroupingParamPanel({ params, onChange, disabled }: GroupingParamPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const [editing, setEditing] = useState<Editing | null>(null);

  const set = (key: GroupingParamKey) => (value: number) => onChange({ ...params, [key]: value });

  const open = (key: GroupingParamKey, label: string) => () => {
    if (disabled) return;
    setEditing({ key, label, text: String(params[key]) });
  };

  const save = () => {
    if (!editing) return;
    const value = parseGroupingInput(editing.key, editing.text);
    // A refusal leaves the editor open with what was typed still in it: the
    // athlete is one character from a value that works.
    if (value === null) return;
    onChange({ ...params, [editing.key]: value });
    setEditing(null);
  };

  const matchLabel = t('settings.groupingMatchShare', { percent: params.minMatchPercentage });
  const endsLabel = t('settings.groupingEndsApart', {
    distance: formatDistance(params.endpointThreshold),
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
  disabled,
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
  const { min, max, step } = GROUPING_PARAM_RANGES[paramKey];
  return (
    <View style={styles.paramRow}>
      <Pressable
        onPress={onEdit}
        disabled={disabled}
        testID={`grouping-edit-${paramKey}`}
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

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} testID="grouping-editor">
      <Pressable style={styles.scrim} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}
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
            {t('settings.sectionParamRange', { min, max })}
          </Text>
          <View style={styles.sheetActions}>
            <Pressable
              onPress={onCancel}
              testID="grouping-editor-cancel"
              accessibilityRole="button"
            >
              <Text style={[styles.sheetAction, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable onPress={onSave} testID="grouping-editor-save" accessibilityRole="button">
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
