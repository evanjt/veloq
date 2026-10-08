import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { Button } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import {
  DETECTION_PARAM_RANGES,
  isPastClamp,
  isPastTestedRange,
  parseParamInput,
  GROUPING_PARAM_RANGES,
  isPastGroupingRange,
  parseGroupingInput,
  fromEditorValue,
  toEditorText,
  type ParamEditorSheetInput,
} from '@/features/routes';
import { tapBack } from '@/shared/app/navigation';

function ParamEditorSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<ParamEditorSheetInput, number>();
  const [text, setText] = useState(input?.initial ?? '');
  if (!input) return null;

  const prefix = input.kind === 'param' ? 'param-editor' : 'grouping-editor';
  const range =
    input.kind === 'param' ? DETECTION_PARAM_RANGES[input.key] : GROUPING_PARAM_RANGES[input.key];
  const parsed =
    input.kind === 'param' ? parseParamInput(input.key, text) : parseGroupingInput(input.key, text);
  const value = parsed === null ? null : fromEditorValue(parsed, input.unit);
  const pastRange =
    value !== null &&
    (input.kind === 'param'
      ? isPastTestedRange(input.key, value)
      : isPastGroupingRange(input.key, value));
  const pastClamp = value !== null && input.kind === 'param' && isPastClamp(input.key, value);
  const bound = (metres: number) =>
    input.unit
      ? `${toEditorText(metres, input.unit)} ${input.unit.label}`
      : toEditorText(metres, null);
  const save = () => {
    if (text === input.initial) {
      router.back();
      return;
    }
    if (value === null || value <= 0) return;
    resolve(value);
  };
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const primary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View testID={prefix} style={[styles.sheet, { backgroundColor: surface }]}>
      <Text style={[styles.title, { color: primary }]}>{input.label}</Text>
      <TextInput
        testID={input.kind === 'param' ? 'param-editor-input' : 'grouping-editor-input'}
        value={text}
        onChangeText={setText}
        keyboardType="numeric"
        autoFocus
        selectTextOnFocus
        style={[styles.input, { color: primary, borderColor: border }]}
      />
      <Text style={[styles.note, { color: secondary }]}>
        {t('settings.sectionParamRange', {
          min: bound(range.min),
          max: bound(range.max),
        })}
      </Text>
      {pastRange && (
        <Text testID={`${prefix}-range-note`} style={[styles.note, { color: secondary }]}>
          {t('settings.sectionParamPastRange')}
        </Text>
      )}
      {pastClamp && (
        <Text testID={`${prefix}-clamp-note`} style={[styles.note, { color: secondary }]}>
          {t('settings.sectionParamPastClamp')}
        </Text>
      )}
      <View style={styles.actions}>
        <Button
          testID={input.kind === 'param' ? 'param-editor-cancel' : 'grouping-editor-cancel'}
          label={t('common.cancel')}
          onPress={() => tapBack()}
          variant="ghost"
        />
        <Button
          testID={input.kind === 'param' ? 'param-editor-save' : 'grouping-editor-save'}
          label={t('common.save')}
          onPress={save}
          variant="ghost"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: spacing.md, gap: spacing.sm },
  title: { ...typography.bodyMedium },
  input: {
    ...typography.body,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  note: { ...typography.caption },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
});

export default withScreenBoundary(ParamEditorSheetContent, 'Parameter Editor');
