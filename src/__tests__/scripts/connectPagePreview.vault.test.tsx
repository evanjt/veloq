/**
 * Scenario: the connect page draws each feed row's track from the preview
 * line the phone sends with the page.
 *
 * Expected behaviour: a row with a line renders an SVG path fit to the
 * thumbnail with start and end marks. A row with no line, or a line that is
 * a single point, renders the sport mark instead.
 */

import type React from 'react';

import { Thumbnail } from '../../../web/connect/App';
import { THUMB, sportMark, trackShape } from '../../../web/connect/preview';
import vectors from '../../../modules/veloqrs/rust/veloqrs/tests/fixtures/track_codec_vectors.json';
import type { Card } from '../../../web/connect/session';

type Case = { name: string; bytes: number[] };

function previewOf(name: string): string {
  const found = (vectors.cases as Case[]).find((c) => c.name === name);
  if (!found) throw new Error(`no vector ${name}`);
  return Buffer.from(found.bytes).toString('base64');
}

const ELEVATED = 'every point carries elevation';

function card(extra: Partial<Card>): Card {
  return { id: 'a1', sportType: 'Ride', hasGps: true, ...extra } as Card;
}

function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

type Drawn = { type: string; props: Record<string, unknown> };

/** Thumbnail is a pure function of its props, so its element is read directly. */
function drawn(element: React.ReactElement<{ card: Card; preview: string | undefined }>): Drawn {
  return (Thumbnail as (props: { card: Card; preview: string | undefined }) => Drawn)(
    element.props
  );
}

describe('trackShape', () => {
  it('fits the line inside the thumbnail', () => {
    const shape = trackShape(previewOf(ELEVATED));
    expect(shape).not.toBeNull();
    const numbers = numbersIn(shape!.path);
    expect(numbers.length).toBe(6);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(THUMB);
    }
    expect(shape!.path.startsWith('M')).toBe(true);
    expect(shape!.start).toEqual([numbers[0], numbers[1]]);
    expect(shape!.end).toEqual([numbers[4], numbers[5]]);
  });

  it('fills the box along its longer side and keeps north up', () => {
    const shape = trackShape(previewOf(ELEVATED))!;
    const [startX, startY] = shape.start;
    const [endX, endY] = shape.end;
    expect(endY).toBeLessThan(startY);
    expect(endX).toBeGreaterThan(startX);
    const ys = numbersIn(shape.path).filter((_, at) => at % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(THUMB - 8, 0);
  });

  it('draws nothing for an empty or single-point line', () => {
    expect(trackShape(previewOf('empty'))).toBeNull();
    expect(trackShape(previewOf('single point without elevation'))).toBeNull();
  });
});

describe('Thumbnail', () => {
  it('renders a path fit to its bounds for a row with a line', () => {
    const el = drawn(<Thumbnail card={card({})} preview={previewOf(ELEVATED)} />);
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe(`0 0 ${THUMB} ${THUMB}`);
    const [path, start, end] = el.props.children as Drawn[];
    expect(String(path?.props.d).startsWith('M')).toBe(true);
    expect(start?.props.className).toBe('thumb-start');
    expect(end?.props.className).toBe('thumb-end');
  });

  it('renders the sport mark for a row with no line', () => {
    const el = drawn(
      <Thumbnail card={card({ hasGps: false, sportType: 'Run' })} preview={undefined} />
    );
    expect(el.type).toBe('span');
    expect(el.props.className).toBe('thumb thumb-sport');
    expect(el.props['data-sport']).toBe('run');
  });

  it('renders the sport mark when the line cannot be drawn', () => {
    const el = drawn(
      <Thumbnail card={card({})} preview={previewOf('single point without elevation')} />
    );
    expect(el.type).toBe('span');
  });
});

describe('sportMark', () => {
  it('names the family of a sport', () => {
    expect(sportMark('VirtualRide').family).toBe('ride');
    expect(sportMark('Hike').family).toBe('walk');
    expect(sportMark(null).family).toBe('other');
  });
});
