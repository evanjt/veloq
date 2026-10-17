/**
 * Scenario: the activity, route and section heroes put the stack's transparent
 * header and its white back control over the map. On the default pale
 * basemap, a white control over a white tile has no contrast at all.
 *
 * Expected behaviour: the hero darkens the band under the header in every case,
 * enough for a white control to hold WCAG 1.4.11's 3:1 over a pure white tile,
 * and takes no touches so the map still pans beneath it.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { DetailHero } from '@/shared/ui/DetailHero';

const HEADER_BOTTOM = 47 + 44;

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

function relativeLuminance([r, g, b]: number[]) {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The colour a translucent stop, as the gradient hands it to native, lays over a white tile. */
function overWhite(processed: number) {
  const argb = processed >>> 0;
  const a = (argb >>> 24) / 255;
  return [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255].map((c) => c * a + 255 * (1 - a));
}

function contrastWithWhite(rgb: number[]) {
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

const renderHero = () =>
  render(
    <HeaderHeightContext.Provider value={HEADER_BOTTOM}>
      <DetailHero height={320} overlay={<Text>Lake Tekapo loop</Text>}>
        <Text>map</Text>
      </DetailHero>
    </HeaderHeightContext.Provider>
  );

describe('DetailHero top scrim', () => {
  it('draws a scrim from the top edge past the header', async () => {
    await renderHero();

    const scrim = screen.getByTestId('detail-hero-top-scrim');
    const style = StyleSheet.flatten(scrim.props.style);
    expect(style.top).toBe(0);
    expect(style.height).toBeGreaterThanOrEqual(HEADER_BOTTOM);
  });

  it('takes no touches', async () => {
    await renderHero();

    expect(screen.getByTestId('detail-hero-top-scrim').props.pointerEvents).toBe('none');
  });

  it('holds 3:1 for a white back control over a white tile across the header band', async () => {
    await renderHero();

    const scrim = screen.getByTestId('detail-hero-top-scrim');
    const { height } = StyleSheet.flatten(scrim.props.style);
    const colours: number[] = scrim.props.colors;
    const locations: number[] = scrim.props.locations;
    const headerBottom = HEADER_BOTTOM / (height as number);

    // Every stop up to the first one at or past the header's bottom edge, so the
    // band between them is an interpolation of passing colours.
    const lastHeld = locations.findIndex((location) => location >= headerBottom);
    expect(lastHeld).toBeGreaterThanOrEqual(0);
    for (const colour of colours.slice(0, lastHeld + 1)) {
      expect(contrastWithWhite(overWhite(colour))).toBeGreaterThanOrEqual(3);
    }
  });
});
