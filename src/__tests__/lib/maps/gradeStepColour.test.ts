/**
 * Scenario: the activity line coloured by grade, drawn over the light, dark or
 * satellite base map.
 *
 * Expected behaviour: each grade band takes the base map's own diverging step,
 * a colour always means one band rather than a blend, and ground within 2 % of
 * flat takes the base's grey.
 */

import { colourTokens } from '@/theme';
import {
  buildGradientLineStops,
  gradeStepColour,
  gradientStepExpression,
} from '@/features/maps/lib/gradientLineColor';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

const STYLES: MapStyleType[] = ['light', 'dark', 'satellite'];
const token = (style: MapStyleType, step: string) =>
  (colourTokens.light as Record<string, string>)[`map-${style}-div-${step}`];

describe.each(STYLES)('on the %s base map', (style) => {
  it.each([
    [-25, 'cool-3'],
    [-10.5, 'cool-3'],
    [-10, 'cool-2'],
    [-7, 'cool-2'],
    [-5, 'cool-1'],
    [-2.5, 'cool-1'],
    [-2, 'mid'],
    [-1.9, 'mid'],
    [0, 'mid'],
    [1.9, 'mid'],
    [2, 'mid'],
    [2.1, 'warm-1'],
    [5, 'warm-1'],
    [7, 'warm-2'],
    [10, 'warm-2'],
    [10.1, 'warm-3'],
    [40, 'warm-3'],
  ])('a grade of %s %% takes the %s step', (grade, step) => {
    expect(token(style, step)).toMatch(/^#[0-9A-F]{6}$/i);
    expect(gradeStepColour(grade, style)).toBe(token(style, step));
  });

  it('takes grey for a sample with no grade', () => {
    expect(gradeStepColour(NaN, style)).toBe(token(style, 'mid'));
  });

  it('colours the line stops in that base map steps', () => {
    const stops = buildGradientLineStops([-12, 0, 12], [0, 50, 100], style)!;
    expect(stops).toEqual([
      0,
      token(style, 'cool-3'),
      0.5,
      token(style, 'mid'),
      1,
      token(style, 'warm-3'),
    ]);
  });
});

it('gives each base map its own colours for one grade', () => {
  const colours = STYLES.map((style) => gradeStepColour(7, style));
  expect(new Set(colours).size).toBe(STYLES.length);
});

describe('gradientStepExpression', () => {
  it('steps from one band to the next rather than blending between them', () => {
    expect(gradientStepExpression([0, '#000001', 0.4, '#000002', 1, '#000003'])).toEqual([
      'step',
      ['line-progress'],
      '#000001',
      0.4,
      '#000002',
      1,
      '#000003',
    ]);
  });

  it('holds one colour for a line that never changes band', () => {
    expect(gradientStepExpression([0, '#000001', 1, '#000001'])).toEqual([
      'step',
      ['line-progress'],
      '#000001',
    ]);
  });
});
