/**
 * Scenario: a library that syncs the server holds imported rides the server's
 * figures leave out, and the chart card is the place the athlete reads those
 * figures.
 *
 * Expected behaviour: the card names how many imported rides are left out,
 * only while there are any, and the Garmin provenance line stays its own.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { FitnessChartCard } from '@/features/fitness/components/sections/FitnessChartCard';
import { statedForm } from '../__shared__/statedForm';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

let mockSource: { id: string } | null = null;
jest.mock('@/shared/app/source/useSource', () => ({ useSource: () => mockSource }));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  mockSource = null;
});

function card(uncountedImports: number) {
  return (
    <FitnessChartCard
      wellness={statedForm([{ id: '2026-04-01', ctl: 40, atl: 48 }])}
      wellnessCoverage={'Fetched' as never}
      loadDots={[]}
      dailyLoads={[]}
      eftpChanges={[]}
      selectedDate={null}
      sharedSelectedIdx={{ value: -1 } as never}
      onDateSelect={() => {}}
      onInteractionChange={() => {}}
      uncountedImports={uncountedImports}
    />
  );
}

it('says how many imported rides the figures leave out', async () => {
  const tree = await render(card(2));
  expect(tree.getByTestId('fitness-imports-uncounted')).toHaveTextContent(/^2 imported rides/);
});

it('uses the singular form for one', async () => {
  const tree = await render(card(1));
  expect(tree.getByTestId('fitness-imports-uncounted')).toHaveTextContent(/^1 imported ride is/);
});

it('draws nothing when no import is left out', async () => {
  const tree = await render(card(0));
  expect(tree.queryByTestId('fitness-imports-uncounted')).toBeNull();
});

it('leaves a Garmin library with only its own provenance line', async () => {
  mockSource = { id: 'garmin' };
  const tree = await render(card(0));
  expect(tree.getByTestId('fitness-provenance')).toBeTruthy();
  expect(tree.queryByTestId('fitness-imports-uncounted')).toBeNull();
});
