import { buildDeltaLineStops, deltaToColor } from '../deltaLineColor';
import { mapLayerColors } from '@/theme';

const progressOf = (stops: (string | number)[] | null) =>
  (stops ?? []).filter((_, i) => i % 2 === 0) as number[];
const colourOf = (stops: (string | number)[] | null) =>
  (stops ?? []).filter((_, i) => i % 2 === 1) as string[];

describe('buildDeltaLineStops', () => {
  it('places a stop at each bin edge and ends at 1', () => {
    const splits = [1, 2, -1, 0, 3, -2, 1, 0, -3, 2];
    const stops = buildDeltaLineStops(splits, 100, 1000, 'forward');
    const progress = progressOf(stops);
    expect(progress).toHaveLength(11);
    progress.forEach((p, i) => expect(p).toBeCloseTo(i / 10, 10));
    expect(progress[10]).toBe(1);
    progress.slice(1).forEach((p, i) => expect(p).toBeGreaterThan(progress[i]));
  });

  it('colours a bin with no data in the no-data grey', () => {
    const stops = buildDeltaLineStops([2, NaN, -2], 100, 300, 'forward');
    expect(colourOf(stops)[1]).toBe(mapLayerColors.deltaNoData);
  });

  it('clamps the scale symmetrically at the largest absolute bin', () => {
    const stops = buildDeltaLineStops([6, -2], 100, 200, 'forward');
    expect(colourOf(stops)[0]).toBe(mapLayerColors.deltaLost);
    expect(colourOf(stops)[1]).toBe(deltaToColor(-2 / 6));
    expect(deltaToColor(-1)).toBe(mapLayerColors.deltaWon);
    expect(deltaToColor(0)).toBe(mapLayerColors.deltaNeutral);
  });

  it('ends the last short bin at 1, not past it', () => {
    const splits = new Array(10).fill(1);
    const progress = progressOf(buildDeltaLineStops(splits, 100, 950, 'forward'));
    expect(progress[9]).toBeCloseTo(900 / 950, 10);
    expect(progress[10]).toBe(1);
    expect(Math.max(...progress)).toBe(1);
  });

  it('puts the first bin of a reverse attempt at the far end of the line', () => {
    const forward = buildDeltaLineStops([6, 0, 0], 100, 300, 'forward');
    const reverse = buildDeltaLineStops([6, 0, 0], 100, 300, 'reverse');
    expect(colourOf(forward)[0]).toBe(mapLayerColors.deltaLost);
    expect(colourOf(reverse)[0]).toBe(mapLayerColors.deltaNeutral);
    expect(colourOf(reverse)[2]).toBe(mapLayerColors.deltaLost);
    expect(progressOf(reverse)[2]).toBeCloseTo(2 / 3, 10);
  });

  it('mirrors a short last bin to the start of the line on a reverse attempt', () => {
    const progress = progressOf(buildDeltaLineStops([1, 1, 1], 100, 250, 'reverse'));
    expect(progress).toEqual([0, 0.2, 0.6, 1]);
  });

  it('draws nothing without bins or a length', () => {
    expect(buildDeltaLineStops([], 100, 1000, 'forward')).toBeNull();
    expect(buildDeltaLineStops([1], 100, 0, 'forward')).toBeNull();
    expect(buildDeltaLineStops([1], 0, 100, 'forward')).toBeNull();
  });

  it('paints a level attempt neutral', () => {
    expect(colourOf(buildDeltaLineStops([0, 0], 100, 200, 'forward'))).toEqual([
      mapLayerColors.deltaNeutral,
      mapLayerColors.deltaNeutral,
      mapLayerColors.deltaNeutral,
    ]);
  });
});
