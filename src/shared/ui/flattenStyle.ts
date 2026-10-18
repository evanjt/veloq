import {
  StyleSheet,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/**
 * A style prop flattened to one object of its own style type. Expo's web augmentation widens
 * `ViewStyle` and `TextStyle` past the style `StyleSheet.flatten` declares it takes and returns,
 * so the two declarations meet here once rather than at every caller.
 */
export function flattenStyle<T extends ViewStyle | TextStyle | ImageStyle>(style: StyleProp<T>): T {
  return (StyleSheet.flatten(style as never) ?? {}) as T;
}
