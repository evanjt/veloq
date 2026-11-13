/**
 * Scenario: share and delete were drawn with Material glyphs on iOS, and with
 * three share glyphs and four bins between them on Android.
 *
 * Expected behaviour: one glyph per role on each platform. iOS draws the
 * system symbol, Android the one Material glyph for the role, and a context
 * menu entry carries the same pair.
 */

import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';

import { ChromeIcon, chromeMenuIcon, type ChromeRole } from '@/shared/ui/ChromeIcon';

const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
});

async function drawn(name: ChromeRole) {
  const screen = await render(<ChromeIcon name={name} size={20} color="#123456" />);
  const symbols = screen.UNSAFE_queryAllByType(SymbolView);
  const glyphs = screen.UNSAFE_queryAllByType(MaterialCommunityIcons);
  return {
    symbol: symbols[0]?.props as { name?: string; tintColor?: string; size?: number } | undefined,
    glyph: glyphs[0]?.props as { name?: string; color?: string; size?: number } | undefined,
    symbolCount: symbols.length,
  };
}

describe('on iOS', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it.each([
    ['share', 'square.and.arrow.up'],
    ['delete', 'trash'],
  ] as const)(
    'draws %s as the system symbol %s, in the colour and size asked',
    async (role, sf) => {
      const { symbol } = await drawn(role);

      expect(symbol?.name).toBe(sf);
      expect(symbol?.tintColor).toBe('#123456');
      expect(symbol?.size).toBe(20);
    }
  );
});

describe('on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it.each([
    ['share', 'share-variant'],
    ['delete', 'delete-outline'],
  ] as const)('draws %s as the Material glyph %s and no symbol view', async (role, glyphName) => {
    const { glyph, symbolCount } = await drawn(role);

    expect(symbolCount).toBe(0);
    expect(glyph?.name).toBe(glyphName);
    expect(glyph?.color).toBe('#123456');
    expect(glyph?.size).toBe(20);
  });
});

it('gives a context menu entry the same pair the icon draws', () => {
  expect(chromeMenuIcon('share')).toEqual({
    icon: 'share-variant',
    systemIcon: 'square.and.arrow.up',
  });
  expect(chromeMenuIcon('delete')).toEqual({ icon: 'delete-outline', systemIcon: 'trash' });
});
