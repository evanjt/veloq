// The app's glyphs come from a 1.3 MB icon font; the page stands in a text glyph of the same box.
import { createElement } from 'react';
import { Text as NativeText } from 'react-native';
export type IconName = string;
export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: unknown;
  testID?: string;
};
export const hiddenFromScreenReader = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};
export function Icon({ name, size = 24, color, testID }: IconProps) {
  return createElement(
    NativeText,
    { testID, style: { fontSize: size, lineHeight: size, color, width: size } },
    name.slice(0, 1)
  );
}
