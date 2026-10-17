import { Platform, TextStyle } from 'react-native';

// Manrope is the app's face, embedded at build by the `expo-font` plugin in
// `app.json` from `assets/fonts/` at these three weights and no others. Both
// platforms resolve the one family name to the file for a weight: iOS groups
// the files by their typographic family, Android through the font family XML
// the plugin writes. A weight between the three draws the nearest file.
export const typeface = {
  family: 'Manrope',
  weights: ['400', '600', '700'],
} as const;

export type FaceWeight = (typeof typeface.weights)[number];

/** The bundled weight a requested one draws, rounding half up, as a medium label becomes semibold. */
export function faceWeight(weight: TextStyle['fontWeight']): FaceWeight {
  const numeric =
    weight === 'bold' ? 700 : weight === undefined || weight === 'normal' ? 400 : Number(weight);
  if (!Number.isFinite(numeric) || numeric < 500) return '400';
  return numeric < 650 ? '600' : '700';
}

const fontFamily = typeface.family;

// Numbers in a column or a live readout keep one width per digit.
const tabularFigures: TextStyle['fontVariant'] = ['tabular-nums'];

// The system monospaced design, for code and formulas only; `ui-monospace` is
// how iOS is asked for SF Mono, which it exposes to no app by family name.
const codeFamily = Platform.select({
  ios: 'ui-monospace',
  default: 'monospace',
});

export const typography = {
  // Headlines & Titles
  screenTitle: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontFamily,
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
  bodySmallBold: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
  bodyMedium: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 21,
  },
  bodyCompact: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  bodyCompactBold: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 18,
  },

  // Stats & Metrics: every numeric role draws tabular figures
  // Hero timer for the recording screen; tabular numerals stop width jitter.
  statsHero: {
    fontFamily,
    fontSize: 44,
    fontWeight: '700' as const,
    lineHeight: 50,
    letterSpacing: -0.5,
    fontVariant: tabularFigures,
  },
  heroNumber: {
    fontFamily,
    fontSize: 48,
    fontWeight: '700' as const,
    lineHeight: 56,
    letterSpacing: -1,
    fontVariant: tabularFigures,
  },
  largeNumber: {
    fontFamily,
    fontSize: 36,
    fontWeight: '700' as const,
    lineHeight: 42,
    letterSpacing: -0.8,
    fontVariant: tabularFigures,
  },
  headlineNumber: {
    fontFamily,
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 38,
    letterSpacing: -0.6,
    fontVariant: tabularFigures,
  },
  statsValueLarge: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 30,
    letterSpacing: -0.4,
    fontVariant: tabularFigures,
  },
  statsValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    letterSpacing: -0.3,
    fontVariant: tabularFigures,
  },
  statsLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  // The header above a group of rows in a grouped list. Case comes from the
  // transform, so the string under it stays as the translation spells it.
  sectionHeader: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  metricValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    fontVariant: tabularFigures,
  },
  // A cell in a table of numbers.
  tableValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    fontVariant: tabularFigures,
  },

  // Code and formulas
  code: {
    fontFamily: codeFamily,
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 20,
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
    fontWeight: '600' as const,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  micro: {
    fontFamily,
    fontSize: 10,
    fontWeight: '400' as const,
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
