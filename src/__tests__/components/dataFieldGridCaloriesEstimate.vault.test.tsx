/**
 * Scenario: the live calories tile shows a number the app estimated from heart
 * rate or a MET table at an assumed age and, without a profile weight, an
 * assumed weight. Expected behaviour: the tile's label says it is an estimate,
 * and a measured field beside it keeps its plain label.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 140,
  power: 0,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  calories: 412,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

function labelOf(tree: Awaited<ReturnType<typeof render>>, field: string): string {
  const texts = tree
    .getByTestId(`data-field-${field}`)
    .findAll((n) => typeof n.children[0] === 'string')
    .map((n) => n.children[0] as string);
  return texts[texts.length - 1]!;
}

it('labels the calories tile as an estimate', async () => {
  const tree = await render(
    <DataFieldGrid fields={['calories', 'distance']} metrics={METRICS} isMetric />
  );
  expect(labelOf(tree, 'calories')).toBe('Calories (est.)');
  expect(labelOf(tree, 'distance')).toBe(i18n.t('recording.fields.distance'));
  expect(tree.getByTestId('data-field-calories').props.accessibilityLabel).toBe(
    'Calories (est.), 412 kcal'
  );
});
