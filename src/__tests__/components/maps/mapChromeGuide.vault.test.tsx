/**
 * Expected behaviour: the chrome drawn over a map follows the app theme and the
 * guide's anatomy. The compass draws its north half in the compass role and its
 * south half in the secondary icon ink wherever it appears, with no caller
 * choosing either. The attribution is the raised surface at the pressed opacity
 * with 10 px text. A key is the raised card with the map-overlay shadow, each
 * row a 16 by 4 swatch beside a caption. A popup is the raised surface.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Path } from 'react-native-svg';
import { render, screen } from '@testing-library/react-native';

import { CompassArrow, StaticCompassArrow } from '@/shared/ui/CompassArrow';
import { MapControlButton } from '@/features/maps/components/MapControlButton';
import { AttributionOverlay } from '@/features/maps/components/AttributionOverlay';
import { MapKey, MapKeySwatch } from '@/features/maps/components/MapKey';
import { MapPopup } from '@/features/maps/components/regional/MapPopup';
import { colors, colorWithOpacity, darkColors, opacity, raised, typography } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

function flat(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) ?? {};
}

const THEMES = [
  { name: 'light', isDark: false, palette: colors },
  { name: 'dark', isDark: true, palette: darkColors },
] as const;

afterEach(() => {
  mockIsDark = false;
});

describe.each(THEMES)('map chrome in the $name theme', ({ isDark, palette }) => {
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws the compass in the compass role and the secondary icon ink by default', async () => {
    await render(<CompassArrow rotation={new Animated.Value(0)} />);
    const [north, south] = screen.UNSAFE_getAllByType(Path).map((path) => path.props.fill);
    expect(north).toBe(palette.compassNorth);
    expect(south).toBe(palette.iconSecondary);
  });

  it('draws the map button compass in the same two colours', async () => {
    await render(
      <MapControlButton accessibilityLabel="north" onPress={() => {}}>
        <MapControlButton.Compass rotation={new Animated.Value(0)} />
      </MapControlButton>
    );
    const [north, south] = screen.UNSAFE_getAllByType(Path).map((path) => path.props.fill);
    expect(north).toBe(palette.compassNorth);
    expect(south).toBe(palette.iconSecondary);
  });

  it('draws the static compass in the same two colours', async () => {
    await render(<StaticCompassArrow bearing={30} />);
    const halves = screen.UNSAFE_root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (flat(node).borderBottomColor !== undefined || flat(node).borderTopColor !== undefined)
    );
    const colours = halves.map((node) => {
      const style = flat(node);
      return style.borderBottomWidth ? style.borderBottomColor : style.borderTopColor;
    });
    expect(colours).toEqual([palette.compassNorth, palette.iconSecondary]);
  });

  it('draws the attribution on the raised surface at the pressed opacity in 10 px text', async () => {
    await render(<AttributionOverlay initialAttribution="© Lighthouse Survey" />);
    expect(flat(screen.getByTestId('map-attribution-bar')).backgroundColor).toBe(
      colorWithOpacity(palette.surfaceRaised, opacity.pressed)
    );
    const text = flat(screen.getByTestId('map-attribution-text'));
    expect(text.fontSize).toBe(10);
    expect(text.color).toBe(palette.textSecondary);
  });

  it('draws a key as the raised card with the map-overlay shadow and caption rows', async () => {
    await render(
      <MapKey isDark={isDark} testID="key">
        <MapKeySwatch swatch="#123456" label="Tide line" isDark={isDark} />
      </MapKey>
    );
    const card = flat(screen.getByTestId('key'));
    expect(card.backgroundColor).toBe(palette.surfaceRaised);
    expect(card).toMatchObject(raised('mapOverlay', isDark));
    const swatch = flat(screen.getByTestId('map-key-swatch'));
    expect([swatch.width, swatch.height]).toEqual([16, 4]);
    const label = flat(screen.getByText('Tide line'));
    expect(label.fontSize).toBe(typography.caption.fontSize);
    expect(label.lineHeight).toBe(typography.caption.lineHeight);
  });

  it('fills the column a stretched key swatch sits in, plain or dashed', async () => {
    await render(
      <>
        <MapKeySwatch testID="plain" stretch swatch={['#111111', '#222222']} isDark={isDark} />
        <MapKeySwatch
          testID="dashed"
          stretch
          swatch={['#111111', '#222222']}
          dash={[3, 2]}
          edge="#ffffff"
          isDark={isDark}
        />
      </>
    );
    for (const id of ['plain', 'dashed']) {
      expect(flat(screen.getByTestId(id)).alignSelf).toBe('stretch');
    }
    const [plain, dashed] = screen.getAllByTestId('map-key-swatch').map(flat);
    expect(plain.width).toBeUndefined();
    expect(plain.flex).toBe(1);
    expect(dashed.flex).toBe(1);
    expect(dashed.overflow).toBe('hidden');
    const dashes = screen.getAllByTestId('map-key-dash').map(flat);
    const gaps = screen.getAllByTestId('map-key-dash-gap').map(flat);
    expect(dashes.length * 3 * 4 + gaps.length * 2 * 4).toBeGreaterThanOrEqual(240);
    expect(dashes.map((d) => d.backgroundColor).slice(0, 3)).toEqual([
      '#111111',
      '#222222',
      '#111111',
    ]);
  });

  it('draws a popup on the raised surface', async () => {
    await render(
      <MapPopup
        testID="popup"
        titleTestID="popup-title"
        closeTestID="popup-close"
        titleRef={React.createRef()}
        title="Harbour loop"
        stats={[]}
        closeLabel="Close"
        onClose={() => {}}
      />
    );
    expect(flat(screen.getByTestId('popup')).backgroundColor).toBe(palette.surfaceRaised);
  });
});
