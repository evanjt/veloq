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
import { gradeStepColour } from '@/features/maps/lib/gradientLineColor';
import { streamsFromArrays, type StreamArrays } from '@/features/activity/lib/streams';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const track = Array.from({ length: 5 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const GRADE = [12, 7, 3, -3, -7];
const colour = (grade: number) => gradeStepColour(grade, 'light');

const stopsOf = async (arrays: StreamArrays) => {
  const streams = streamsFromArrays(arrays);
  const { result } = await renderHook(() =>
    useMapLayers({ validCoordinates: track, coordinates: track, streams, mapStyle: 'light' })
  );
  const expression = result.current.gradientLineExpression as (string | number | unknown[])[];
  expect(expression.slice(0, 2)).toEqual(['step', ['line-progress']]);
  return expression.slice(2);
};

it('places each colour stop at its share of the distance', async () => {
  const stops = await stopsOf({ grade_smooth: GRADE, distance: [0, 100, 150, 500, 1000] });

  expect(stops).toEqual([
    colour(12),
    0.1,
    colour(7),
    0.15,
    colour(3),
    0.5,
    colour(-3),
    1,
    colour(-7),
  ]);
});

it('measures the share from where the distance stream starts', async () => {
  const stops = await stopsOf({ grade_smooth: GRADE, distance: [200, 300, 350, 700, 1200] });

  expect(stops[stops.indexOf(0.5) + 1]).toBe(colour(-3));
});

it('places the stops by sample when there is no distance stream', async () => {
  const stops = await stopsOf({ grade_smooth: GRADE });

  expect(stops.filter((s) => typeof s === 'number')).toEqual([0.25, 0.5, 0.75, 1]);
});
