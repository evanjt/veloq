// The app animates this with Reanimated; the page draws it still.
import { createElement } from 'react';
import { Text as NativeText } from 'react-native';
export function DisclosureChevron({
  expanded,
  size,
  color,
}: {
  expanded: boolean;
  size: number;
  color: string;
}) {
  return createElement(NativeText, { style: { fontSize: size, color } }, expanded ? '⌃' : '⌄');
}
