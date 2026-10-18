/**
 * The one bar a tool that works on the map runs through: creating a section,
 * editing a section's bounds. It names the tool with the length drawn so far,
 * gives one line of hint, and leaves by Cancel or Save, so every map tool has
 * its label, its length and its way out in the same place.
 *
 * It is a view over the bottom of the map and not a stop of the map's sheet:
 * the native sheet holds three detents on Android and the bar is a fourth
 * height.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';
import { FitText } from '@/shared/ui/FitText';
import { layers, raised, spacing, themePalette, typography } from '@/theme';

/** The hint's tone: a prompt, a caution about the selection, or why the tool cannot save. */
export type MapToolHintTone = 'muted' | 'warning' | 'error';

export interface MapToolBarProps {
  /** The tool's name with its live length, from `mapToolTitle`. */
  title: string;
  hint: string;
  hintTone?: MapToolHintTone;
  /** What a screen reader says for the hint when the visible line alone does not carry it. */
  hintAccessibilityLabel?: string | undefined;
  onCancel: () => void;
  onDone: () => void;
  /** The done button's word, Save unless the tool's state calls for another. */
  doneLabel?: string | undefined;
  doneDisabled?: boolean;
  /** A write is under way: Save shows it and neither button takes a press. */
  busy?: boolean;
  /** Puts the tool's selection back, drawn as a visible secondary before Cancel. */
  reset?: { onPress: () => void; disabled?: boolean } | undefined;
  /** The space under the bar that belongs to the system, such as the home indicator. */
  bottomInset?: number;
  testID?: string;
  cancelTestID?: string;
  doneTestID?: string;
  /** Detail the tool shows above its row, such as a failure's technical details. */
  children?: React.ReactNode;
}

/** A title line and a hint line between the bar's padding: 76. */
export const MAP_TOOL_BAR_HEIGHT =
  typography.bodyBold.lineHeight + typography.caption.lineHeight + spacing.xsPlus + 2 * spacing.md;

export function MapToolBar({
  title,
  hint,
  hintTone = 'muted',
  hintAccessibilityLabel,
  onCancel,
  onDone,
  doneLabel,
  doneDisabled = false,
  busy = false,
  reset,
  bottomInset = 0,
  testID = 'map-tool-bar',
  cancelTestID = 'map-tool-cancel',
  doneTestID = 'map-tool-save',
  children,
}: MapToolBarProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const hintColor =
    hintTone === 'error'
      ? palette.errorText
      : hintTone === 'warning'
        ? palette.warningText
        : palette.textSecondary;

  return (
    <View
      testID={testID}
      style={[
        styles.bar,
        raised('elevated', isDark),
        { backgroundColor: palette.surfaceRaised, paddingBottom: spacing.md + bottomInset },
      ]}
    >
      {children}
      <View style={styles.row}>
        <View style={styles.text}>
          <FitText
            accessibilityRole="header"
            style={[styles.title, { color: palette.textPrimary }]}
          >
            {title}
          </FitText>
          <Text
            numberOfLines={2}
            style={[styles.hint, { color: hintColor }]}
            accessibilityLabel={hintAccessibilityLabel}
            accessibilityLiveRegion="polite"
          >
            {hint}
          </Text>
        </View>
        {reset ? (
          <Button
            testID="map-tool-reset"
            variant="ghost"
            size="sm"
            label={t('common.reset')}
            onPress={reset.onPress}
            disabled={busy || reset.disabled === true}
          />
        ) : null}
        <Button
          testID={cancelTestID}
          variant="secondary"
          size="sm"
          label={t('common.cancel')}
          onPress={onCancel}
          disabled={busy}
        />
        <Button
          testID={doneTestID}
          size="sm"
          label={doneLabel ?? t('common.save')}
          onPress={onDone}
          disabled={doneDisabled}
          loading={busy}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: MAP_TOOL_BAR_HEIGHT,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    zIndex: layers.overlay,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    gap: spacing.xsPlus,
  },
  title: {
    ...typography.bodyBold,
  },
  hint: {
    ...typography.caption,
  },
});
