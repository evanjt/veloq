/**
 * Scenario: the section rebuild ended on an error, once before it replaced
 * anything and once after it had, over a library whose list is empty and over
 * one that still lists its old sections.
 *
 * Expected behaviour: the Sections list says the rebuild did not finish and
 * that it runs again, in words that match what the engine left in place. A
 * settled or idle rebuild says nothing.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { FfiCatalogueEmptyReason } from 'veloqrs';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { CutoverSummary } from '@/features/routes/hooks/useCutoverSummary';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#000000', textSecondary: '#666666', textOnDark: '#ffffff' },
  }),
  useMetricSystem: () => true,
  useAppSettings: () => ({ settings: {} }),
}));

jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false, refusal: null }),
}));

jest.mock('@/features/routes/hooks/useDetectionHold', () => ({
  useDetectionHold: () => null,
}));

jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => undefined,
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn() }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({}),
}));

let mockCutover: CutoverSummary;
jest.mock('@/features/routes/hooks/useCutoverSummary', () => ({
  useCutoverSummary: () => mockCutover,
}));

function summary(over: Partial<CutoverSummary>): CutoverSummary {
  return {
    phase: 'idle',
    isRunning: false,
    counts: null,
    countsOwed: false,
    settingsReset: null,
    sawRun: false,
    ...over,
  };
}

const HELD_BY_MIGRATION = {
  tag: 'Held',
  inner: { hold: { tag: 'Cutover' } },
} as unknown as FfiCatalogueEmptyReason;

function renderList(emptyReason: FfiCatalogueEmptyReason | null) {
  return render(
    <SectionsList
      batchSections={[]}
      totalSectionCount={0}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={0}
      customSectionCount={0}
      removedSectionCount={0}
      emptyReason={emptyReason}
    />
  );
}

const DID_NOT_FINISH =
  'The section rebuild did not finish. Your sections are unchanged and it runs again next launch.';
const REBUILT_NOT_SUMMARISED =
  'Your sections were rebuilt, but the summary of what changed was not saved. It is written again next launch.';

describe('SectionsList after a failed rebuild', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
    mockCutover = summary({});
  });

  it('says the rebuild did not finish when the list is empty', async () => {
    mockCutover = summary({ phase: 'failed' });

    await renderList(HELD_BY_MIGRATION);

    expect(screen.getByTestId('cutover-failed')).toBeTruthy();
    expect(screen.getByText(DID_NOT_FINISH)).toBeTruthy();
  });

  it('says it when the old sections are still listed', async () => {
    mockCutover = summary({ phase: 'failed' });

    await renderList(null);

    expect(screen.getByText(DID_NOT_FINISH)).toBeTruthy();
  });

  it('does not call the sections unchanged when the failure came after the apply', async () => {
    mockCutover = summary({ phase: 'failed_after_apply' });

    await renderList(null);

    expect(screen.getByText(REBUILT_NOT_SUMMARISED)).toBeTruthy();
    expect(screen.queryByText(DID_NOT_FINISH)).toBeNull();
  });

  it.each(['idle', 'detecting', 'complete'] as const)('says nothing in phase %s', async (phase) => {
    mockCutover = summary({ phase, isRunning: phase === 'detecting' });

    await renderList(null);

    expect(screen.queryByTestId('cutover-failed')).toBeNull();
  });
});
