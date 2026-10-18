import { requireOptionalNativeModule } from 'expo-modules-core';
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

interface VeloqAccessibilityModule {
  boldText(): boolean;
}

/**
 * Whether the system's bold text setting was on at launch. The roles below are
 * spread into styles when their modules load, so the setting is read once, here,
 * and a change while the app runs shows at the next launch. With no native
 * module to ask (Jest, a web build) or a read that fails, it is off.
 */
function readBoldText(): boolean {
  try {
    return (
      requireOptionalNativeModule<VeloqAccessibilityModule>('VeloqAccessibility')?.boldText() ===
      true
    );
  } catch {
    return false;
  }
}

export const BOLD_TEXT = readBoldText();

// One file up the face's weights, the heaviest staying where it is.
const heavierFace: Record<FaceWeight, FaceWeight> = { '400': '600', '600': '700', '700': '700' };

/**
 * The bundled weight a requested one draws, rounding half up, as a medium label
 * becomes semibold. With bold text on it draws one file heavier: 400 as 600,
 * 600 as 700, and 700 stays, the heaviest the face ships.
 */
export function faceWeight(
  weight: TextStyle['fontWeight'],
  boldText: boolean = BOLD_TEXT
): FaceWeight {
  const numeric =
    weight === 'bold' ? 700 : weight === undefined || weight === 'normal' ? 400 : Number(weight);
  const nearest: FaceWeight =
    !Number.isFinite(numeric) || numeric < 500 ? '400' : numeric < 650 ? '600' : '700';
  return boldText ? heavierFace[nearest] : nearest;
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
    fontWeight: faceWeight('700'),
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: faceWeight('700'),
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  cardTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: faceWeight('600'),
    lineHeight: 24,
    letterSpacing: -0.2,
  },

  // Body text
  body: {
    fontFamily,
    fontSize: 16,
    fontWeight: faceWeight('400'),
    lineHeight: 22,
  },
  bodyBold: {
    fontFamily,
    fontSize: 16,
    fontWeight: faceWeight('600'),
    lineHeight: 22,
  },
  bodySmall: {
    fontFamily,
    fontSize: 14,
    fontWeight: faceWeight('400'),
    lineHeight: 20,
  },
  bodySmallBold: {
    fontFamily,
    fontSize: 14,
    fontWeight: faceWeight('600'),
    lineHeight: 20,
  },
  bodyMedium: {
    fontFamily,
    fontSize: 15,
    fontWeight: faceWeight('400'),
    lineHeight: 21,
  },
  bodyCompact: {
    fontFamily,
    fontSize: 13,
    fontWeight: faceWeight('400'),
    lineHeight: 18,
  },
  bodyCompactBold: {
    fontFamily,
    fontSize: 13,
    fontWeight: faceWeight('600'),
    lineHeight: 18,
  },

  // Stats & Metrics: every numeric role draws tabular figures
  // Hero timer for the recording screen; tabular numerals stop width jitter.
  statsHero: {
    fontFamily,
    fontSize: 44,
    fontWeight: faceWeight('700'),
    lineHeight: 50,
    letterSpacing: -0.5,
    fontVariant: tabularFigures,
  },
  heroNumber: {
    fontFamily,
    fontSize: 48,
    fontWeight: faceWeight('700'),
    lineHeight: 56,
    letterSpacing: -1,
    fontVariant: tabularFigures,
  },
  largeNumber: {
    fontFamily,
    fontSize: 36,
    fontWeight: faceWeight('700'),
    lineHeight: 42,
    letterSpacing: -0.8,
    fontVariant: tabularFigures,
  },
  headlineNumber: {
    fontFamily,
    fontSize: 32,
    fontWeight: faceWeight('700'),
    lineHeight: 38,
    letterSpacing: -0.6,
    fontVariant: tabularFigures,
  },
  statsValueLarge: {
    fontFamily,
    fontSize: 24,
    fontWeight: faceWeight('700'),
    lineHeight: 30,
    letterSpacing: -0.4,
    fontVariant: tabularFigures,
  },
  statsValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: faceWeight('700'),
    lineHeight: 26,
    letterSpacing: -0.3,
    fontVariant: tabularFigures,
  },
  statsLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: faceWeight('400'),
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  // The header above a group of rows in a grouped list. Case comes from the
  // transform, so the string under it stays as the translation spells it.
  sectionHeader: {
    fontFamily,
    fontSize: 12,
    fontWeight: faceWeight('600'),
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  metricValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: faceWeight('600'),
    lineHeight: 24,
    fontVariant: tabularFigures,
  },
  // A cell in a table of numbers.
  tableValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: faceWeight('400'),
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
    fontWeight: faceWeight('400'),
    lineHeight: 16,
  },
  captionBold: {
    fontFamily,
    fontSize: 12,
    fontWeight: faceWeight('600'),
    lineHeight: 16,
  },
  label: {
    fontFamily,
    fontSize: 11,
    fontWeight: faceWeight('600'),
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  micro: {
    fontFamily,
    fontSize: 10,
    fontWeight: faceWeight('400'),
    lineHeight: 12,
    letterSpacing: 0.2,
  },

  // Pills & Badges
  // A number in a pill, a chip or a live chart readout.
  pillValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: faceWeight('700'),
    lineHeight: 18,
    fontVariant: tabularFigures,
  },
  pillLabel: {
    fontFamily,
    fontSize: 9,
    fontWeight: faceWeight('600'),
    lineHeight: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  // A badge's count, record word or signed change, in tabular figures so a
  // count keeps its width as it changes.
  badge: {
    fontFamily,
    fontSize: 11,
    fontWeight: faceWeight('600'),
    lineHeight: 14,
    fontVariant: tabularFigures,
  },
} as const;
