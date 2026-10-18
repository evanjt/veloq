/**
 * The round button that floats over a map, the one way every map draws one.
 *
 * It is a 40 px disc on the raised surface with the map-overlay shadow, which
 * it keeps in dark mode beside the card edge, so it lifts off any base drawn
 * under it. `IconButton` underneath lifts the disc to the platform tap minimum
 * through hit slop and draws the on state: a toggle passes `selected` and is
 * filled with the control-on blue under the on-fill glyph. The surface follows
 * the app theme, never the base map.
 */

import React from 'react';
import {
  Platform,
  StyleSheet,
  type AccessibilityState,
  type Animated,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { CompassArrow } from '@/shared/ui/CompassArrow';
import { IconButton } from '@/shared/ui/IconButton';
import {
  colors,
  controlHeight,
  darkColors,
  gapBetweenTargets,
  iconSize,
  layout,
  raised,
} from '@/theme';

/** The drawn diameter of a map button. */
export const MAP_CONTROL_SIZE = controlHeight.button;

/** The gap between two map buttons, so their hit slops never overlap. */
export const MAP_CONTROL_GAP = gapBetweenTargets(MAP_CONTROL_SIZE);

export interface MapControlButtonProps {
  /** What a screen reader announces. Required: an icon has no text of its own. */
  accessibilityLabel: string;
  onPress: () => void;
  /** A toggle's state: on fills the control-on blue, and both states reach a screen reader. */
  selected?: boolean;
  disabled?: boolean;
  accessibilityState?: AccessibilityState;
  /** Where the button sits; the disc itself is the button's to draw. */
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
  children: React.ReactNode;
}

export function MapControlButton({
  accessibilityLabel,
  onPress,
  selected,
  disabled,
  accessibilityState,
  style,
  testID,
  children,
}: MapControlButtonProps) {
  const { isDark } = useTheme();
  return (
    <IconButton
      testID={testID}
      variant="ghost"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      {...(selected === undefined ? {} : { selected })}
      {...(disabled === undefined ? {} : { disabled })}
      {...(accessibilityState === undefined ? {} : { accessibilityState })}
      style={[
        styles.disc,
        { backgroundColor: (isDark ? darkColors : colors).surfaceRaised },
        raised('mapOverlay', isDark),
        style,
      ]}
    >
      {children}
    </IconButton>
  );
}

/** A glyph in its map button's ink, at the one size every map button draws. */
function MapControlGlyph({
  name,
}: {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}) {
  return <IconButton.Glyph name={name} size={iconSize.md} />;
}

/** The compass needle, at the size every map button draws its glyph. */
function MapControlCompass({ rotation }: { rotation: Animated.Value }) {
  return <CompassArrow size={iconSize.md} rotation={rotation} />;
}

MapControlButton.Glyph = MapControlGlyph;
MapControlButton.Compass = MapControlCompass;
MapControlButton.Spinner = IconButton.Spinner;

const styles = StyleSheet.create({
  disc: {
    width: MAP_CONTROL_SIZE,
    height: MAP_CONTROL_SIZE,
    borderRadius: layout.borderRadiusFull,
    // iOS clips a view's own shadow to its bounds when it clips its children.
    overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
  },
});
