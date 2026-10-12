/**
 * Scenario: a climb run thirty times and ridden twenty. The ground has no
 * sport of its own, so the busier sport is not the section's.
 * Expected behaviour: the sections row and the regional map popup each draw
 * every sport that took the section, and neither names one sport as the
 * section's.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render } from '@testing-library/react-native';

import { SectionRow } from '@/features/routes/components/SectionRow';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
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

function iconNames(view: Awaited<ReturnType<typeof render>>): string[] {
  return view.UNSAFE_getAllByType(MaterialCommunityIcons).map((icon) => icon.props.name as string);
}

function count(names: string[], name: string): number {
  return names.filter((n) => n === name).length;
}

it('the sections row draws each sport once and gives no sport to the empty preview', async () => {
  const names = iconNames(await render(<SectionRow section={MIXED} />));

  expect(count(names, 'bike')).toBe(1);
  expect(count(names, 'run')).toBe(1);
});

it('the map popup draws every sport and names none of them', async () => {
  const view = await render(<SectionPopup section={MIXED} bottom={0} onClose={jest.fn()} />);

  expect(iconNames(view)).toContain('bike');
  expect(view.queryByText('Run')).toBeNull();
  expect(view.queryByText('Ride')).toBeNull();
});
