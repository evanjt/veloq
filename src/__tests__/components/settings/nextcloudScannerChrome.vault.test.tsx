/**
 * Scenario: the QR scanner draws over the camera feed, or over black when the
 * camera is refused, so its chrome is fixed rather than following the theme.
 *
 * Expected behaviour: the strips over the feed are the scrim, every label and
 * glyph is the white text-on-fill, and the refused camera's glyph is that
 * white at the pressed opacity, which still reads at 4.5:1 on the black.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';

import { NextcloudQrScanner } from '@/features/settings/components/NextcloudQrScanner';
import { colorWithOpacity, colourTokens, darkColors, opacity } from '@/theme';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('expo-camera', () => ({
  ...jest.requireActual('expo-camera'),
  CameraView: () => null,
  useCameraPermissions: jest.fn(),
}));

function permit(granted: boolean) {
  (useCameraPermissions as jest.Mock).mockReturnValue([
    { status: granted ? 'granted' : 'denied', granted, canAskAgain: false },
    jest.fn(),
    jest.fn().mockResolvedValue(undefined),
  ]);
}

async function renderScanner() {
  return render(
    <NextcloudQrScanner onScanned={jest.fn()} onClose={jest.fn()} onEnterDetails={jest.fn()} />
  );
}

function rgb(colour: string): [number, number, number, number] {
  if (colour.startsWith('#')) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    return [r, g, b, 1];
  }
  const [r, g, b, a = 1] = colour.match(/[\d.]+/g)!.map(Number);
  return [r, g, b, a];
}

function luminance([r, g, b]: number[]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** The ratio of a colour, composited over an opaque ground, to that ground. */
function contrastOver(colour: string, ground: string): number {
  const [r, g, b, a] = rgb(colour);
  const base = rgb(ground);
  const top = [r, g, b].map((c, i) => c * a + base[i] * (1 - a));
  const [hi, lo] = [luminance(top), luminance(base)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function grounds(tree: Awaited<ReturnType<typeof renderScanner>>): string[] {
  return tree
    .UNSAFE_getAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor as string | undefined)
    .filter((colour): colour is string => Boolean(colour));
}

describe('the scanner chrome over the camera feed', () => {
  beforeEach(() => permit(true));

  it('lays the scrim under the header and the instructions', async () => {
    const tree = await renderScanner();

    const strips = grounds(tree).filter((colour) => colour.startsWith('rgba'));
    expect(strips.length).toBeGreaterThanOrEqual(2);
    expect(new Set(strips)).toEqual(new Set([colourTokens.dark.scrim]));
  });

  it('draws every label and glyph in the white text-on-fill', async () => {
    const tree = await renderScanner();

    const inks = [
      ...tree.UNSAFE_getAllByType(Text).map((node) => StyleSheet.flatten(node.props.style)?.color),
      ...tree.UNSAFE_getAllByType(MaterialCommunityIcons).map((node) => node.props.color),
    ].filter(Boolean);
    expect(inks.length).toBeGreaterThan(3);
    expect(new Set(inks)).toEqual(new Set([darkColors.textOnFill]));
  });
});

describe('the scanner with the camera refused', () => {
  beforeEach(() => permit(false));

  it('draws the camera glyph in white at the pressed opacity, at 4.5:1 on its ground', async () => {
    const tree = await renderScanner();

    const ground = grounds(tree)[0];
    const glyph = tree
      .UNSAFE_getAllByType(MaterialCommunityIcons)
      .find((node) => node.props.name === 'camera-off');
    const hint = glyph?.props.color as string;

    expect(hint).toBe(colorWithOpacity(darkColors.textOnFill, opacity.pressed));
    expect(contrastOver(hint, ground)).toBeGreaterThanOrEqual(4.5);
  });
});
