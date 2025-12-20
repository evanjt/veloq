import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const typography = {
  screenTitle: {
    fontFamily,
    fontSize: 28,
    fontWeight: '600' as const,
    lineHeight: 34,
  },
  cardTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 26,
  },
  body: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  statsValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700' as const,
    lineHeight: 24,
  },
  statsLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  caption: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
} as const;
