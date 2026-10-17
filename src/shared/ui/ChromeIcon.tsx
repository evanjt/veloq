/**
 * The glyph for an action every app has, drawn in each platform's own language.
 * iOS draws the system symbol, Android one Material glyph per role, so an
 * action reads the same everywhere on a platform and as that platform's own.
 *
 * The role set is fixed: a caller names what the action does, never a glyph.
 * Sport, data and map glyphs are the app's own and stay on
 * `MaterialCommunityIcons`.
 */

import React from 'react';
import { Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';

type MaterialGlyph = keyof typeof MaterialCommunityIcons.glyphMap;

const GLYPHS = {
  share: { ios: 'square.and.arrow.up', android: 'share-variant' },
  delete: { ios: 'trash', android: 'delete-outline' },
} as const satisfies Record<string, { ios: SFSymbol; android: MaterialGlyph }>;

export type ChromeRole = keyof typeof GLYPHS;

interface ChromeIconProps {
  name: ChromeRole;
  size: number;
  color: string;
  testID?: string;
}

export function ChromeIcon({ name, size, color, testID }: ChromeIconProps) {
  const glyph = GLYPHS[name];
  const material = (
    <MaterialCommunityIcons testID={testID} name={glyph.android} size={size} color={color} />
  );
  if (Platform.OS !== 'ios') return material;
  // The fallback draws where the native symbol view is not built in.
  return (
    <SymbolView
      testID={testID}
      name={glyph.ios}
      size={size}
      tintColor={color}
      fallback={material}
    />
  );
}

/** The pair a context menu entry carries for a role: the popup glyph and the system symbol. */
export function chromeMenuIcon(name: ChromeRole): {
  icon: MaterialGlyph;
  systemIcon: (typeof GLYPHS)[ChromeRole]['ios'];
} {
  return { icon: GLYPHS[name].android, systemIcon: GLYPHS[name].ios };
}
