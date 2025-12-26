import { Platform, TextStyle } from 'react-native';

// iOS uses San Francisco (SF Pro) via system font with specific weights
// Using -apple-system ensures proper SF Pro rendering with optical sizing
const fontFamily = Platform.select({
  ios: '-apple-system',
  android: 'Roboto',
  default: 'System',
});

// SF Pro Display for large headlines (optimized for 20pt+)
const displayFamily = Platform.select({
  ios: '-apple-system',
  android: 'Roboto',
  default: 'System',
});

// Monospace for metrics (tabular numbers)
// SF Mono on iOS for consistency with system
const monoFamily = Platform.select({
  ios: 'SF Mono',
  android: 'monospace',
  default: 'monospace',
});

export const typography = {
  // Headlines & Titles (use displayFamily for optimal rendering at large sizes)
  screenTitle: {
    fontFamily: displayFamily,
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontFamily: displayFamily,
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  cardTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    letterSpacing: -0.2,
  },

  // Body text
  body: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodyBold: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  bodySmall: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },

  // Stats & Metrics (large numbers use displayFamily)
  heroNumber: {
    fontFamily: displayFamily,
    fontSize: 48,
    fontWeight: '700' as const,
    lineHeight: 56,
    letterSpacing: -1,
  },
  largeNumber: {
    fontFamily: displayFamily,
    fontSize: 36,
    fontWeight: '700' as const,
    lineHeight: 42,
    letterSpacing: -0.8,
  },
  statsValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  statsLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  metricValue: {
    fontFamily: monoFamily,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
  },

  // Small text
  caption: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  captionBold: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
  },
  label: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500' as const,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  micro: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500' as const,
    lineHeight: 12,
    letterSpacing: 0.2,
  },

  // Pills & Badges
  pillValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700' as const,
    lineHeight: 18,
  },
  pillLabel: {
    fontFamily,
    fontSize: 9,
    fontWeight: '600' as const,
    lineHeight: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  badge: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 14,
  },
} as const;

export type TypographyKey = keyof typeof typography;
