/**
 * Scenario: the feed and the fitness page each drew their own summary tiles, with different
 * heights and no delta, and the feed's wrapped over itself at 1280 px.
 *
 * Expected behaviour: one tile carries a label, a figure, an optional delta with its sign and its
 * comparison label, and an optional sparkline; a strip lays out its tiles as a list; the page grid
 * is a plain container that marks a card as spanning two tracks.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { GridCell, PageGrid } from '../../../web/connect/ui/PageGrid';
import { StatStrip, StatTile, sparkPoints } from '../../../web/connect/ui/StatTile';

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const render = (element: React.ReactElement) => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  return (tree as ReactTestRenderer).root;
};

describe('StatTile', () => {
  it('renders a rise with a plus sign and its comparison label', () => {
    const tile = render(
      <StatTile label="Fitness" value="62" delta={{ change: 3.24, label: 'vs last week' }} />
    );

    const delta = tile.findByProps({ 'data-trend': 'up' });
    expect(textOf(delta)).toBe('+3.2 vs last week');
  });

  it('renders a fall with a minus sign and a flat change with none', () => {
    const fall = render(
      <StatTile label="Form" value="-8" delta={{ change: -4, label: 'vs last week' }} />
    );
    const flat = render(
      <StatTile label="Form" value="-8" delta={{ change: 0, label: 'vs last week' }} />
    );

    expect(textOf(fall.findByProps({ 'data-trend': 'down' }))).toBe('−4.0 vs last week');
    expect(textOf(flat.findByProps({ 'data-trend': 'flat' }))).toBe('0.0 vs last week');
  });

  it('reads a change that rounds to zero as flat, never as a signed zero', () => {
    const tile = render(
      <StatTile label="Ramp" value="1" delta={{ change: -0.02, label: 'vs last week' }} />
    );

    expect(textOf(tile.findByProps({ 'data-trend': 'flat' }))).toBe('0.0 vs last week');
  });

  it('draws no delta and no sparkline unless it is given one', () => {
    const tile = render(<StatTile label="Fitness" value="62" />);

    expect(tile.findAllByProps({ 'data-trend': 'up' })).toEqual([]);
    expect(tile.findAllByType('svg')).toEqual([]);
    expect(textOf(tile.findByProps({ 'data-part': 'label' }))).toBe('Fitness');
    expect(textOf(tile.findByProps({ 'data-part': 'value' }))).toBe('62');
  });

  it('draws a sparkline over its series, and none for a series of one point', () => {
    const drawn = render(<StatTile label="Fitness" value="62" spark={[1, 3, 2]} />);
    const none = render(<StatTile label="Fitness" value="62" spark={[5]} />);

    expect(drawn.findByType('polyline').props.points).toBe('0.0,32.0 60.0,0.0 120.0,16.0');
    expect(none.findAllByType('polyline')).toEqual([]);
  });
});

describe('sparkPoints', () => {
  it('draws a flat series along the bottom edge', () => {
    expect(sparkPoints([4, 4, 4])).toBe('0.0,32.0 60.0,32.0 120.0,32.0');
  });

  it('is empty below two points', () => {
    expect(sparkPoints([])).toBe('');
    expect(sparkPoints([1])).toBe('');
  });
});

describe('StatStrip', () => {
  it('lists each tile once, in order', () => {
    const strip = render(
      <StatStrip id="strip" label="Summary">
        <StatTile label="A" value="1" />
        <StatTile label="B" value="2" />
        <StatTile label="C" value="3" />
        <StatTile label="D" value="4" />
      </StatStrip>
    );

    const items = strip.findAllByType('li');
    expect(items.map((item) => textOf(item.findByProps({ 'data-part': 'label' })))).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(strip.findByType('ul').props['aria-label']).toBe('Summary');
  });
});

describe('PageGrid', () => {
  it('marks a card as spanning two tracks only when asked', () => {
    const grid = render(
      <PageGrid id="grid">
        <GridCell>one</GridCell>
        <GridCell span={2}>two</GridCell>
      </PageGrid>
    );

    const cells = grid.findAllByProps({ className: 'ui-grid-cell' });
    expect(cells.map((cell) => cell.props['data-span'])).toEqual([undefined, 2]);
  });
});
