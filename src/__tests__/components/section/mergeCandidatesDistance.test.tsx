/**
 * Expected behaviour: a merge candidate row shows how far the candidate's
 * centre is from this section, as the engine reports it.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { MergeCandidatesModal } from '@/features/routes/components/section/MergeCandidatesModal';
import type { MergeCandidate } from 'veloqrs';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockIsMetric = true;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockIsMetric,
}));

function candidate(centerDistanceMeters: number): MergeCandidate {
  return {
    sectionId: 'c1',
    name: 'Ridge',
    sportTypes: ['Ride'],
    visitCount: 4,
    distanceMeters: 900,
    overlapPct: 0.5,
    centerDistanceMeters,
  } as MergeCandidate;
}

function renderRow(centerDistanceMeters: number) {
  return render(
    <MergeCandidatesModal
      visible
      candidates={[candidate(centerDistanceMeters)]}
      onSelect={jest.fn()}
      onCancel={jest.fn()}
    />
  );
}

beforeEach(() => {
  mockIsMetric = true;
});

it('shows the centre distance in metres', () => {
  const view = renderRow(120);
  expect(view.getByText(/sections\.distanceAway:\{"distance":"120 m"\}/)).toBeTruthy();
});

it('shows the centre distance in kilometres', () => {
  const view = renderRow(3200);
  expect(view.getByText(/sections\.distanceAway:\{"distance":"3\.2 km"\}/)).toBeTruthy();
});

it('shows the centre distance in imperial units', () => {
  mockIsMetric = false;
  const view = renderRow(3200);
  expect(view.getByText(/sections\.distanceAway:\{"distance":"[\d.]+ mi"\}/)).toBeTruthy();
});
