/**
 * Scenario: a feed card draws its body diagrams from the library's shapes
 * rather than through the library's component.
 *
 * Expected behaviour: each shape takes the colour the component would give it,
 * and each diagram sits where the component's view box would put it.
 */

import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront';
import { bodyFemaleBack } from 'react-native-body-highlighter/dist/assets/bodyFemaleBack';

import {
  bodyFills,
  bodyOutline,
  bodyViewBox,
  fitViewBox,
} from '@/features/strength/lib/bodyDiagramPicture';

const SHADES = ['assist', 'lead'];

function fillsOf(slug: string, fills: ReturnType<typeof bodyFills>, parts = bodyFront) {
  const part = parts.find((p) => p.slug === slug)!;
  const ds = new Set([
    ...(part.path?.common ?? []),
    ...(part.path?.left ?? []),
    ...(part.path?.right ?? []),
  ]);
  return fills.filter((f) => ds.has(f.d)).map((f) => f.fill);
}

describe('bodyFills', () => {
  it('draws every shape of the diagram once, trained or not', () => {
    const shapes = bodyFront.flatMap((p) => [
      ...(p.path?.common ?? []),
      ...(p.path?.left ?? []),
      ...(p.path?.right ?? []),
    ]);

    expect(bodyFills([], 'male', 'front', SHADES).map((f) => f.d)).toEqual(shapes);
  });

  it('keeps the drawing colour on every part when nothing was trained', () => {
    const fills = bodyFills([], 'male', 'front', SHADES);
    const chest = bodyFront.find((p) => p.slug === 'chest')!;

    expect(new Set(fillsOf('chest', fills))).toEqual(new Set([chest.color]));
  });

  it('picks the shade by intensity, the first shade for one and the second for two', () => {
    const fills = bodyFills(
      [
        { slug: 'chest', intensity: 2 },
        { slug: 'abs', intensity: 1 },
      ],
      'male',
      'front',
      SHADES
    );

    expect(new Set(fillsOf('chest', fills))).toEqual(new Set(['lead']));
    expect(new Set(fillsOf('abs', fills))).toEqual(new Set(['assist']));
    expect(new Set(fillsOf('biceps', fills))).not.toContain('lead');
  });

  it('leaves a zero intensity in the drawing colour', () => {
    const chest = bodyFront.find((p) => p.slug === 'chest')!;
    const fills = bodyFills([{ slug: 'chest', intensity: 0 }], 'male', 'front', SHADES);

    expect(new Set(fillsOf('chest', fills))).toEqual(new Set([chest.color]));
  });

  it('prefers a part fill, then a part colour, over the intensity shade', () => {
    const fills = bodyFills(
      [
        { slug: 'chest', intensity: 2, styles: { fill: 'styled' } },
        { slug: 'abs', intensity: 2, color: 'coloured' },
      ],
      'male',
      'front',
      SHADES
    );

    expect(new Set(fillsOf('chest', fills))).toEqual(new Set(['styled']));
    expect(new Set(fillsOf('abs', fills))).toEqual(new Set(['coloured']));
  });

  it('colours only the trained half of a part trained on one side', () => {
    const chest = bodyFront.find((p) => p.slug === 'chest')!;
    const fills = bodyFills(
      [{ slug: 'chest', intensity: 2, side: 'left' }],
      'male',
      'front',
      SHADES
    );
    const byPath = new Map(fills.map((f) => [f.d, f.fill]));

    expect(chest.path!.left!.map((d) => byPath.get(d))).toEqual(
      chest.path!.left!.map(() => 'lead')
    );
    expect(chest.path!.right!.map((d) => byPath.get(d))).toEqual(
      chest.path!.right!.map(() => chest.color)
    );
  });

  it('reads the female drawing for a female body', () => {
    const fills = bodyFills([{ slug: 'gluteal', intensity: 2 }], 'female', 'back', SHADES);

    expect(new Set(fillsOf('gluteal', fills, bodyFemaleBack))).toEqual(new Set(['lead']));
  });
});

describe('the diagram frame', () => {
  it('reads each body and side its own view box', () => {
    expect(bodyViewBox('male', 'front')).toEqual({ x: 0, y: 0, width: 724, height: 1448 });
    expect(bodyViewBox('male', 'back')).toEqual({ x: 724, y: 0, width: 724, height: 1448 });
    expect(bodyViewBox('female', 'front')).toEqual({ x: -50, y: -40, width: 734, height: 1538 });
    expect(bodyViewBox('female', 'back')).toEqual({ x: 756, y: 0, width: 774, height: 1448 });
  });

  it('finds an outline for every body and side', () => {
    for (const gender of ['male', 'female'] as const) {
      for (const side of ['front', 'back'] as const) {
        expect(bodyOutline(gender, side)).toMatch(/^[Mm]/);
      }
    }
    expect(bodyOutline('male', 'front')).not.toEqual(bodyOutline('male', 'back'));
  });

  it('fits a view box whole and centred, shifted past its origin', () => {
    // A box twice as tall as wide in a square: height limits, width centres.
    expect(fitViewBox({ x: 10, y: 0, width: 50, height: 100 }, 100, 100)).toEqual({
      scale: 1,
      dx: 25 - 10,
      dy: 0,
    });
    // A box wider than its slot: width limits, height centres.
    expect(fitViewBox({ x: 0, y: -40, width: 200, height: 100 }, 100, 100)).toEqual({
      scale: 0.5,
      dx: 0,
      dy: 25 + 20,
    });
  });
});
