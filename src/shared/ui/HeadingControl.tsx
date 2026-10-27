/**
 * A title that is also a control.
 *
 * Android carries one role per node, so the header role on a pressable
 * displaces its button role and the control is announced as a heading with no
 * hint that it can be activated. There the pressable is a button, and the
 * heading is a zero-size sibling that is not a focus stop, so the headings
 * list still has the title. iOS combines traits, so the header role stays on
 * the control.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PressTarget, type PressTargetProps } from './PressTarget';

export interface HeadingControlProps extends Omit<PressTargetProps, 'accessibilityRole'> {
  accessibilityLabel: string;
}

export function HeadingControl({ accessibilityLabel, ...props }: HeadingControlProps) {
  if (Platform.OS !== 'android') {
    return (
      <PressTarget {...props} accessibilityRole="header" accessibilityLabel={accessibilityLabel} />
    );
  }

  return (
    <>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel}
        importantForAccessibility="no"
        pointerEvents="none"
        style={styles.marker}
      />
      <PressTarget {...props} accessibilityRole="button" accessibilityLabel={accessibilityLabel} />
    </>
  );
}

const styles = StyleSheet.create({
  marker: { position: 'absolute', width: 0, height: 0 },
});
