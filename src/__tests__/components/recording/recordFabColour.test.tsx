/**
 * Scenario: the record button inherited the brand accent, so it read as one
 * more teal action on a feed of teal actions rather than as recording.
 *
 * Expected behaviour: it paints the recording colour in both themes, and that
 * colour carries its white glyph and separates from the surface behind it.
 * Colour is not the only carrier: the glyph and the label stay.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RecordFAB } from '@/features/recording/components/RecordFAB';
import { BottomInsetTaken, TAB_BAR_SAFE_PADDING } from '@/shared/ui/tabBarClearance';
import { brand, colors, darkColors, recording, shadows, spacing } from '@/theme';

/** WCAG 2.2 AA for a graphical object, which is what a glyph on a fill is. */
const AA_GRAPHIC = 3;
/** The glyph is small and carries the whole meaning, so it is held to text. */
const AA_TEXT = 4.5;

function relativeLuminance(hex: string): number {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const theme = { isDark: false };
const session = { status: 'idle' };

jest.mock('@/shared/app', () => ({
  useTheme: () => theme,
}));

// The barrel reaches the engine through SyncErrorBanner, which has no native
// module under Jest. Only the clearance is wanted here.
jest.mock('@/shared/ui', () => ({
  useBottomClearance: jest.requireActual('@/shared/ui/tabBarClearance').useBottomClearance,
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['(tabs)'],
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('@/features/recording/stores/RecordingStore', () => ({
  useRecordingStore: (selector: (s: typeof session) => unknown) => selector(session),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

async function fabStyle(isDark: boolean) {
  theme.isDark = isDark;
  const { getByTestId } = await render(<RecordFAB />);
  return StyleSheetFlatten(getByTestId('record-fab').props.style);
}

function StyleSheetFlatten(style: unknown): Record<string, unknown> {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved) as Record<string, unknown>;
}

describe('the record button reads as recording', () => {
  beforeEach(() => {
    theme.isDark = false;
    session.status = 'idle';
  });

  it('paints the recording colour and not the brand accent, in light', async () => {
    expect((await fabStyle(false)).backgroundColor).toBe(recording.light);
    expect((await fabStyle(false)).backgroundColor).not.toBe(brand.tealLight);
  });

  it('paints the recording colour and not the brand accent, in dark', async () => {
    expect((await fabStyle(true)).backgroundColor).toBe(recording.dark);
    expect((await fabStyle(true)).backgroundColor).not.toBe(brand.tealDark);
  });

  it('carries its white glyph in both themes', () => {
    expect(contrastRatio(recording.light, colors.textOnDark)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(recording.dark, colors.textOnDark)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('separates from the surface it floats over in both themes', () => {
    expect(contrastRatio(recording.light, colors.background)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    expect(contrastRatio(recording.dark, darkColors.background)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it('does not rely on colour alone: the glyph and the label stay', async () => {
    theme.isDark = false;
    const view = await render(<RecordFAB />);
    const fab = view.getByTestId('record-fab');

    expect(fab.props.accessibilityRole).toBe('button');
    expect(fab.props.accessibilityLabel).toBe('Start activity');
    expect(view.UNSAFE_queryAllByProps({ name: 'record-circle-outline' })).not.toHaveLength(0);
  });

  it('floats above the tab bar on the feed, by the inset plus the bar', async () => {
    expect((await fabStyle(false)).bottom).toBe(24 + TAB_BAR_SAFE_PADDING + spacing.md);
  });

  it('keeps the inset inside the feed safe area, whose padding does not lift a floating view', async () => {
    const { getByTestId } = await render(
      <BottomInsetTaken.Provider value>
        <RecordFAB />
      </BottomInsetTaken.Provider>
    );
    expect(StyleSheetFlatten(getByTestId('record-fab').props.style).bottom).toBe(
      24 + TAB_BAR_SAFE_PADDING + spacing.md
    );
  });

  it.each([false, true])(
    'draws the shared record-button shadow and none of its own (dark %s)',
    async (isDark) => {
      const style = await fabStyle(isDark);
      const shadowKeys = [
        'elevation',
        'shadowColor',
        'shadowOffset',
        'shadowOpacity',
        'shadowRadius',
      ] as const;
      const drawn = Object.fromEntries(
        shadowKeys.filter((key) => style[key] !== undefined).map((key) => [key, style[key]])
      );

      expect(drawn).toEqual(shadows.fab);
    }
  );

  it('stays hidden while a session is running', async () => {
    session.status = 'recording';
    const { queryByTestId } = await render(<RecordFAB />);

    expect(queryByTestId('record-fab')).toBeNull();
  });
});
