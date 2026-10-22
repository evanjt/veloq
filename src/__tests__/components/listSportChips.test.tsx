/**
 * Scenario: an athlete with several sports narrows the routes or the sections
 * list to one of them.
 *
 * Expected behaviour: the list header carries the shared sport chips, one per
 * sport, inline and with no dialog. A chip narrows the list to its sport, the
 * selected chip pressed again clears the filter, and a selected sport that has
 * dropped out of the options keeps its chip so it can still be cleared.
 */

import React from 'react';
import { Modal } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SectionWithPolyline } from 'veloqrs';

import { RoutesList } from '@/features/routes/components/RoutesList';
import { SectionsList } from '@/features/routes/components/SectionsList';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
  useMetricSystem: () => true,
  useAppSettings: () => ({ settings: {} }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false, refusal: null }),
}));
jest.mock('@/features/routes/hooks/useDetectionHold', () => ({ useDetectionHold: () => null }));
jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => undefined,
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn() }),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => ({ enableSection: jest.fn() }) }));

async function routes(sportType: string | undefined, sportOptions: string[] = ['Ride', 'Run']) {
  const onSportChange = jest.fn();
  await render(
    <RoutesList
      onRefresh={jest.fn()}
      batchGroups={[]}
      sortOption="activities"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      totalGroupCount={4}
      shownGroupCount={0}
      sportOptions={sportOptions}
      sportType={sportType}
      onSportChange={onSportChange}
    />
  );
  return onSportChange;
}

const section = {
  id: 'auto_a',
  name: 'Alpha',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  encodedPolyline: '',
  distanceMeters: 1000,
  visitCount: 1,
  isUserDefined: true,
  disabled: false,
} as unknown as SectionWithPolyline;

async function sections(sportType: string | undefined) {
  const onSportChange = jest.fn();
  await render(
    <SectionsList
      batchSections={[section]}
      totalSectionCount={1}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={1}
      customSectionCount={0}
      removedSectionCount={0}
      sportOptions={['Ride', 'Run']}
      sportType={sportType}
      onSportChange={onSportChange}
    />
  );
  return onSportChange;
}

const chip = (sport: string) => screen.getByTestId(`sport-filter-chip-${sport}`);

describe('the routes list sport filter', () => {
  it('draws one chip per sport and no dialog', async () => {
    await routes(undefined);
    expect(chip('Ride')).toHaveTextContent('activityTypes.Ride');
    expect(chip('Run')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('narrows the list to the sport of the chip pressed', async () => {
    const onSportChange = await routes(undefined);
    await fireEvent.press(chip('Run'));
    expect(onSportChange).toHaveBeenCalledWith('Run');
  });

  it('marks the selected sport and clears it when pressed again', async () => {
    const onSportChange = await routes('Run');
    expect(chip('Run').props.accessibilityState.selected).toBe(true);
    expect(chip('Ride').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(chip('Run'));
    expect(onSportChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps a chip for a selected sport that has dropped out of the options', async () => {
    const onSportChange = await routes('Swim', ['Ride']);
    await fireEvent.press(chip('Swim'));
    expect(onSportChange).toHaveBeenCalledWith(undefined);
  });

  it('draws no chips for an athlete with one sport', async () => {
    await routes(undefined, ['Ride']);
    expect(screen.queryByTestId('sport-filter-chip-Ride')).toBeNull();
  });
});

describe('the sections list sport filter', () => {
  it('draws the same chips with no dialog, and narrows to the sport pressed', async () => {
    const onSportChange = await sections(undefined);
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    await fireEvent.press(chip('Ride'));
    expect(onSportChange).toHaveBeenCalledWith('Ride');
  });

  it('clears the selected sport when its chip is pressed again', async () => {
    const onSportChange = await sections('Ride');
    await fireEvent.press(chip('Ride'));
    expect(onSportChange).toHaveBeenCalledWith(undefined);
  });
});

// The Removed chip is driven by the removed count the screen read carries,
// which is a different figure from the ledger's retired count. It shows only
// when there is a removed section to offer, and never off the ledger count,
// which the list does not read.
describe('the sections list removed chip', () => {
  const removedChip = () => screen.queryByRole('button', { name: 'sections.removedCount' });

  async function renderWithRemoved(removedCount: number) {
    await render(
      <SectionsList
        batchSections={[section]}
        totalSectionCount={1}
        sortOption="name"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        hiddenFilters={{ custom: false, auto: false, disabled: false, unaccepted: false }}
        onHiddenFiltersChange={jest.fn()}
        unacceptedAutoCount={0}
        acceptedAutoCount={0}
        customSectionCount={0}
        removedSectionCount={removedCount}
        sportOptions={['Ride', 'Run']}
        sportType={undefined}
        onSportChange={jest.fn()}
      />
    );
  }

  it('offers the chip when the removed count is above zero', async () => {
    await renderWithRemoved(3);
    expect(removedChip()).toBeTruthy();
  });

  it('offers no chip when the removed count is zero', async () => {
    await renderWithRemoved(0);
    expect(removedChip()).toBeNull();
  });
});
