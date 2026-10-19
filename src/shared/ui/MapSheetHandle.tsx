/**
 * The map sheet's handle: one adjustable element named for what it sizes, whose value is the stop
 * the sheet rests at. A tap steps the sheet up a stop and wraps Full to Peek, and a screen
 * reader's increment and decrement move it a stop and stop at either end, all through
 * `useMapSheetStop`. It draws Material's 32 by 4 bar in the track colour only where the platform
 * draws no grabber of its own, and stays an element for the screen reader where it does.
 */

import React, { useCallback } from 'react';
import { AccessibilityActionEvent, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app/useTheme';
import { mapSheetStopName, useMapSheetStop } from '@/shared/app/mapSheetStop';
import { colors, darkColors, layout, slopToMinTapTarget, spacing } from '@/theme';

import { PressTarget } from './PressTarget';

const STOP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

/** The handle area's drawn height: the padding above and below the bar, and the bar. */
const HANDLE_AREA_HEIGHT = spacing.md + spacing.xs + spacing.sm;

export function MapSheetHandle({ sheetKey, drawn }: { sheetKey: string; drawn: boolean }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { stop, step, tapHandle } = useMapSheetStop(sheetKey);
  const palette = isDark ? darkColors : colors;
  const name = mapSheetStopName(stop);
  const stopValue =
    name === 'peek'
      ? t('maps.sheetStop.peek')
      : name === 'full'
        ? t('maps.sheetStop.full')
        : t('maps.sheetStop.half');

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') step('up');
      else if (event.nativeEvent.actionName === 'decrement') step('down');
    },
    [step]
  );

  return (
    <PressTarget
      testID="map-sheet-handle"
      style={[styles.handleArea, !drawn && styles.undrawn]}
      onPress={tapHandle}
      hitSlop={drawn ? slopToMinTapTarget(HANDLE_AREA_HEIGHT) : undefined}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('maps.sheetSize')}
      accessibilityValue={{ text: stopValue }}
      accessibilityActions={STOP_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
    >
      {drawn ? (
        <View
          testID="map-sheet-handle-bar"
          style={[styles.handle, { backgroundColor: palette.track }]}
        />
      ) : null}
    </PressTarget>
  );
}

/**
 * The handle as Android draws it, with nothing to press, for a sheet's shape standing in before
 * the sheet itself is presented.
 */
export function MapSheetHandleBar() {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  return (
    <View style={styles.handleArea}>
      <View style={[styles.handle, { backgroundColor: palette.track }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Where the system draws the grabber, the element takes no height of its own.
  undrawn: {
    paddingTop: 0,
    paddingBottom: 0,
  },
  handle: {
    width: spacing.xl,
    height: spacing.xs,
    borderRadius: layout.borderRadiusFull,
  },
});
