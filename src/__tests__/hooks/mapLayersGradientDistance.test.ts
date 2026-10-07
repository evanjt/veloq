/**
 * Scenario: the activity map colours its line by gradient, and the rider went
 * slowly up the climb and fast down it, so the grade samples, taken by time,
 * bunch up on the climb.
 *
 * Expected behaviour: the map hands the distance stream to the gradient
 * builder, so each colour stop sits at its sample's share of the distance
 * rather than its share of the samples.
 */

import { renderHook } from '@testing-library/react-native';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { gradientToColor } from '@/features/maps/lib/gradientLineColor';
import type { ActivityStreams } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const track = Array.from({ length: 5 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const GRADE = [8, 6, 4, -5, -9];

const stopsOf = (streams: ActivityStreams) => {
  const { result } = renderHook(() =>
    useMapLayers({ validCoordinates: track, coordinates: track, streams })
  );
  const expression = result.current.gradientLineExpression as (string | number | unknown[])[];
  expect(expression.slice(0, 3)).toEqual(['interpolate', ['linear'], ['line-progress']]);
  return expression.slice(3);
};

it('places each colour stop at its share of the distance', () => {
  const stops = stopsOf({ grade_smooth: GRADE, distance: [0, 100, 150, 500, 1000] });

  expect(stops).toEqual([
    0,
    gradientToColor(8),
    0.1,
    gradientToColor(6),
    0.15,
    gradientToColor(4),
    0.5,
    gradientToColor(-5),
    1,
    gradientToColor(-9),
  ]);
});

it('measures the share from where the distance stream starts', () => {
  const stops = stopsOf({ grade_smooth: GRADE, distance: [200, 300, 350, 700, 1200] });

  expect(stops[stops.indexOf(0.5) + 1]).toBe(gradientToColor(-5));
});

it('places the stops by sample when there is no distance stream', () => {
  const stops = stopsOf({ grade_smooth: GRADE });

  expect(stops.filter((s) => typeof s === 'number')).toEqual([0, 0.25, 0.5, 0.75, 1]);
});
