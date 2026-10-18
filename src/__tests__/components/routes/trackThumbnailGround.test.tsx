/**
 * Scenario: the route, section and insight thumbnails each drew their own
 * green gradient bed with grid lines and a drop shadow, in a colour the caller
 * chose, so the section row carried a second copy of the drawing and a route
 * row could colour its line by sport.
 *
 * Expected behaviour: every thumbnail is the one track preview, on the base
 * map's flat land with no gradient or grid, the line in the base map's route
 * colour over its casing, a start disc and an ink finish square.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Circle, LinearGradient, Polyline, Rect } from 'react-native-svg';

import { SectionRow } from '@/features/routes/components/SectionRow';
import { TrackPreview, fitTrackToBox } from '@/shared/ui/TrackPreview';
import { colourTokens } from '@/theme/colourTokens.generated';
import { mapPalette } from '@/theme/palette';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockDark }),
  useMetricSystem: () => true,
}));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [
    { lat: 46.5, lng: 6.6 },
    { lat: 46.51, lng: 6.62 },
    { lat: 46.52, lng: 6.61 },
  ],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

const POINTS = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.2 },
  { x: 1, y: 1 },
];

const trackPreviewType = (TrackPreview as unknown as { type: React.ComponentType }).type;

describe.each([
  ['light', false],
  ['dark', true],
] as const)('the track thumbnail in the %s theme', (theme, dark) => {
  const base = mapPalette(theme);
  const alias = colourTokens[theme];

  beforeEach(() => {
    mockDark = dark;
  });

  it('reads the theme aliases for land, route and casing', () => {
    expect(base.land).toBe(alias['map-land']);
    expect(base.route).toBe(alias['map-route']);
    expect(base.casing).toBe(alias['map-route-casing']);
  });

  it('lays the line on flat land, with no gradient and no grid', async () => {
    const view = await render(<TrackPreview points={POINTS} isDark={dark} />);

    expect(view.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
    const ground = view.UNSAFE_getAllByType(Rect)[0]!;
    expect(ground.props.fill).toBe(base.land);
    // The casing and the line, and nothing drawn across the box.
    const lines = view.UNSAFE_getAllByType(Polyline);
    expect(lines.map((l) => l.props.stroke)).toEqual([base.casing, base.route]);
    expect(lines[1]!.props.strokeWidth).toBe(2.5);
    expect(lines[0]!.props.strokeWidth).toBeGreaterThan(2.5);
  });

  it('marks the start with a start disc and the finish with an ink square, 6px across', async () => {
    const view = await render(<TrackPreview points={POINTS} isDark={dark} />);
    const [start, , finish] = fitTrackToBox(POINTS, 48, 36, 4);

    const disc = view
      .UNSAFE_getAllByType(Circle)
      .find((c) => c.props.cx === start!.x && c.props.cy === start!.y)!;
    expect(disc.props.fill).toBe(base.start);
    expect(disc.props.r * 2).toBe(6);

    const square = view
      .UNSAFE_getAllByType(Rect)
      .find((r) => r.props.x + r.props.width / 2 === finish!.x)!;
    expect(square.props.fill).toBe(base.ink);
    expect(square.props.width).toBe(6);
  });

  it('draws the section row through the one track preview', async () => {
    const view = await render(<SectionRow section={SECTION} />);

    expect(view.UNSAFE_queryAllByType(trackPreviewType)).toHaveLength(1);
    expect(view.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
    const lines = view.UNSAFE_getAllByType(Polyline);
    expect(lines.map((l) => l.props.stroke)).toEqual([base.casing, base.route]);
  });
});
