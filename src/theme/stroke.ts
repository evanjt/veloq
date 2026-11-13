import { StyleSheet } from 'react-native';
import { strokeWidths } from './strokeWidths';

/** The four widths a border, rule or ring is drawn at: the platform's hairline and `strokeWidths`. */
export const stroke = {
  hairline: StyleSheet.hairlineWidth,
  ...strokeWidths,
} as const;
