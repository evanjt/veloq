/**
 * Scenario: the athlete's most-ridden routes are spread over several regions,
 * so framing every route drawn opens the grouping preview on a view of the
 * whole world, where no line can be read.
 *
 * Expected behaviour: the camera frames the routes that pass through the
 * selected area and nothing further, falls back to the area itself when no
 * route reaches it, and has nothing to frame without an area.
 */
import { groupingAreaBounds } from '@/features/routes/lib/groupingAreaCamera';
import { PREVIEW_BIN_DEG } from '@/features/routes/lib/previewMapCamera';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

// floor(46.948 / 0.045) = 1043, floor(7.447 / 0.045) = 165.
const CENTRE = { binKey: '1043:165', lat: 46.948, lng: 7.447 };
const AREA = {
  sw: [165 * PREVIEW_BIN_DEG, 1043 * PREVIEW_BIN_DEG],
  ne: [166 * PREVIEW_BIN_DEG, 1044 * PREVIEW_BIN_DEG],
};

const LOOP_THROUGH_AREA = {
  groupId: 'loop',
  bounds: { minLat: 46.9, maxLat: 47.02, minLng: 7.38, maxLng: 7.52 },
};
const RIDE_INTO_AREA = {
  groupId: 'commute',
  bounds: { minLat: 46.94, maxLat: 46.96, minLng: 7.44, maxLng: 7.6 },
};
const OTHER_CONTINENT = {
  groupId: 'holiday',
  bounds: { minLat: -33.95, maxLat: -33.85, minLng: 151.15, maxLng: 151.25 },
};

it('frames the routes that pass through the area', () => {
  const bounds = groupingAreaBounds(CENTRE, [LOOP_THROUGH_AREA, RIDE_INTO_AREA]);

  expect(bounds).toEqual({ sw: [7.38, 46.9], ne: [7.6, 47.02] });
});

it('leaves out a route that never reaches the area', () => {
  const bounds = groupingAreaBounds(CENTRE, [LOOP_THROUGH_AREA, OTHER_CONTINENT]);

  expect(bounds).toEqual({ sw: [7.38, 46.9], ne: [7.52, 47.02] });
});

it('frames the area itself when no route reaches it', () => {
  expect(groupingAreaBounds(CENTRE, [OTHER_CONTINENT])).toEqual(AREA);
  expect(groupingAreaBounds(CENTRE, [])).toEqual(AREA);
});

it('skips a route with no track', () => {
  const bounds = groupingAreaBounds(CENTRE, [{ bounds: undefined }]);

  expect(bounds).toEqual(AREA);
});

it('has nothing to frame without an area', () => {
  expect(groupingAreaBounds(null, [LOOP_THROUGH_AREA])).toBeNull();
});
