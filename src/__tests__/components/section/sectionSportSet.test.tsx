/**
 * Scenario: a climb run thirty times and ridden twenty. The ground has no
 * sport of its own, so the busier sport is not the section's.
 * Expected behaviour: the sections row, the regional map popup, the merge
 * picker and the merge dialog each draw every sport that took the section, and
 * none of them names one sport as the section's.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render } from '@testing-library/react-native';
import type { MergeCandidate } from 'veloqrs';

import { SectionRow } from '@/features/routes/components/SectionRow';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import { MergeCandidatesModal } from '@/features/routes/components/section/MergeCandidatesModal';
import { MergeConfirmDialog } from '@/features/routes/components/section/MergeConfirmDialog';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

// `sportType` is the label the engine used to send beside the set, the busier
// sport. A reader still keyed on it draws the run twice and the ride not at all.
const MIXED = {
  id: 's1',
  sectionType: 'auto',
  name: 'Hill',
  sportType: 'Run',
  sportTypes: ['Ride', 'Run'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1', 'a2'],
  visitCount: 50,
  createdAt: '2026-01-01T00:00:00Z',
} as FrequentSection;

function iconNames(view: ReturnType<typeof render>): string[] {
  return view.UNSAFE_getAllByType(MaterialCommunityIcons).map((icon) => icon.props.name as string);
}

function count(names: string[], name: string): number {
  return names.filter((n) => n === name).length;
}

it('the sections row draws each sport once and gives no sport to the empty preview', () => {
  const names = iconNames(render(<SectionRow section={MIXED} />));

  expect(count(names, 'bike')).toBe(1);
  expect(count(names, 'run')).toBe(1);
});

it('the map popup draws every sport and names none of them', () => {
  const view = render(<SectionPopup section={MIXED} bottom={0} onClose={jest.fn()} />);

  expect(iconNames(view)).toContain('bike');
  expect(view.queryByText('Run')).toBeNull();
  expect(view.queryByText('Ride')).toBeNull();
});

it('the merge picker draws every sport of a candidate', () => {
  const candidate = {
    sectionId: 's2',
    name: 'Other Hill',
    sportType: 'Run',
    sportTypes: ['Ride', 'Run'],
    distanceMeters: 1150,
    visitCount: 12,
    overlapPct: 0.8,
    centerDistanceMeters: 40,
  } as MergeCandidate;
  const view = render(
    <MergeCandidatesModal
      visible
      candidates={[candidate]}
      onSelect={jest.fn()}
      onCancel={jest.fn()}
    />
  );
  const names = iconNames(view);

  expect(count(names, 'bike')).toBe(1);
  expect(count(names, 'run')).toBe(1);
});

it('the merge dialog draws every sport of each section', () => {
  const view = render(
    <MergeConfirmDialog
      visible
      primary={{
        id: 's1',
        name: 'Hill',
        sportTypes: ['Ride', 'Run'],
        visitCount: 50,
        distanceMeters: 1200,
      }}
      secondary={{
        id: 's2',
        name: 'Other Hill',
        sportTypes: ['Walk'],
        visitCount: 3,
        distanceMeters: 1150,
      }}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
      previewDropped={() => []}
    />
  );
  const names = iconNames(view);

  expect(count(names, 'bike')).toBe(1);
  expect(count(names, 'run')).toBe(1);
  expect(count(names, 'walk')).toBe(1);
});
