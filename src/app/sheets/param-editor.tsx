import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { SheetActions, SheetHeader, TextField } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
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
import { goBack } from '@/shared/app/navigation';

/** What a refused value is told: how to type one the sheet accepts. */
function refusalKey(input: ParamEditorSheetInput) {
  if (input.kind === 'grouping') {
    return input.key === 'minMatchPercentage'
      ? 'settings.groupingParamInvalidPercent'
      : 'settings.sectionParamInvalidWhole';
  }
  return DETECTION_PARAM_RANGES[input.key].integer
    ? 'settings.sectionParamInvalidWhole'
    : 'settings.sectionParamInvalid';
}

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
  // Text left as it opened always saves, so only an edit can be refused.
  const refused = text !== input.initial && (value === null || value <= 0);
  const error = refused ? t(refusalKey(input)) : null;
  const bound = (metres: number) =>
    input.unit
      ? `${toEditorText(metres, input.unit)} ${input.unit.label}`
      : toEditorText(metres, null);
  const save = () => {
    if (text === input.initial) {
      goBack();
      return;
    }
    if (refused || value === null) return;
    resolve(value);
  };
  const rangeText = t('settings.sectionParamRange', {
    min: bound(range.min),
    max: bound(range.max),
  });
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const ids =
    input.kind === 'param'
      ? { cancelTestID: 'param-editor-cancel', saveTestID: 'param-editor-save' }
      : { cancelTestID: 'grouping-editor-cancel', saveTestID: 'grouping-editor-save' };
  const actions = {
    onCancel: () => goBack(),
    cancelTestID: ids.cancelTestID,
    confirm: {
      label: t('common.save'),
      onPress: save,
      disabled: refused,
      testID: ids.saveTestID,
    },
  };

  return (
    <View testID={prefix} style={styles.sheet}>
      <SheetHeader title={input.label} {...actions} />
      <View style={styles.body}>
        <TextField
          testID={input.kind === 'param' ? 'param-editor-input' : 'grouping-editor-input'}
          label={input.label}
          unit={input.unit?.label}
          value={text}
          onChangeText={setText}
          onSubmitEditing={save}
          keyboardType="numeric"
          autoFocus
          selectTextOnFocus
          hint={rangeText}
          error={error}
        />
        {pastRange ? (
          <Text testID={`${prefix}-range-note`} style={[styles.note, { color: secondary }]}>
            {t('settings.sectionParamPastRange')}
          </Text>
        ) : null}
        {pastClamp ? (
          <Text testID={`${prefix}-clamp-note`} style={[styles.note, { color: secondary }]}>
            {t('settings.sectionParamPastClamp')}
          </Text>
        ) : null}
      </View>
      <SheetActions {...actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  body: { flex: 1, paddingHorizontal: layout.screenPadding, gap: spacing.sm },
  note: { ...typography.caption },
});

export default withScreenBoundary(ParamEditorSheetContent, 'Parameter Editor');
