/**
 * Scenario: a strap reports a zone 4 heart rate on a tile whose translated
 * label is long enough to overflow a half-width cell.
 * Expected behaviour: the zone is its own element, so cutting the label at its
 * end never cuts the zone, and the value shrinks to fit rather than ellipsising.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 162,
  power: 0,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

function textNodes(tree: Awaited<ReturnType<typeof render>>, testID: string) {
  return tree.getByTestId(testID).findAll((n) => n.type === Text);
}

function content(node: { props: { children?: unknown } }): string {
  return [node.props.children]
    .flat(5)
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .join('');
}

it('renders the heart rate zone in its own text, apart from the label', async () => {
  const tree = await render(
    <DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric hrZone={{ zone: 4 }} />
  );
  const texts = textNodes(tree, 'data-field-heartrate');
  const zone = texts.filter((n) => content(n) === 'Z4');
  expect(zone).toHaveLength(1);
  const label = texts.find(
    (n) =>
      n.props.numberOfLines === 1 &&
      content(n).length > 0 &&
      content(n) !== 'Z4' &&
      content(n) !== '162 bpm'
  );
  expect(label).toBeDefined();
  expect(content(label!)).not.toContain('Z4');
});

it('shows no zone element when no zone is known', async () => {
  const tree = await render(<DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric />);
  const texts = textNodes(tree, 'data-field-heartrate');
  expect(texts.some((n) => /^Z\d$/.test(content(n)))).toBe(false);
});

it.each(['heartrate', 'speed', 'timer'] as const)(
  'shrinks the %s value to fit with a floor instead of ellipsising',
  async (field) => {
    const tree = await render(
      <DataFieldGrid fields={[field]} metrics={METRICS} isMetric hrZone={{ zone: 4 }} />
    );
    const value = textNodes(tree, `data-field-${field}`)[0];
    expect(value.props.adjustsFontSizeToFit).toBe(true);
    expect(value.props.minimumFontScale).toBeGreaterThan(0);
    expect(value.props.minimumFontScale).toBeLessThan(1);
  }
);
