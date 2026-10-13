/**
 * Scenario: the section merge candidates list and the merge confirmation are formSheet routes
 * that answer their caller through the sheet request channel.
 *
 * Expected behaviour: a tapped candidate resolves the caller with it, the confirmation resolves
 * with the kept and merged ids for the chosen direction, the rides a merge would leave out are
 * named for that direction, distances follow the unit setting, every sport of a section is drawn,
 * and closing without a choice cancels.
 */
import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, ScrollView } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { MergeCandidate } from 'veloqrs';

import MergeCandidatesSheet from '@/app/sheets/merge-candidates';
import MergeConfirmSheet from '@/app/sheets/merge-confirm';
import { openSheet } from '@/shared/app/sheetRequest';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import { initialiseI18n } from '@/i18n';
import type { MergeCandidatesSheetInput, MergeConfirmSheetInput } from '@/features/routes';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockPreviewDropped = jest.fn();
let mockParams: { request?: string } = {};
let mockIsMetric = true;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockIsMetric,
}));
jest.mock('@/features/routes/hooks/useMergeSections', () => ({
  useMergeSections: () => ({ merge: jest.fn(), previewDropped: mockPreviewDropped }),
}));

const candidate = (overrides: Partial<MergeCandidate> = {}): MergeCandidate =>
  ({
    sectionId: 'sec-b',
    name: 'Other Climb',
    sportTypes: ['Ride'],
    visitCount: 4,
    distanceMeters: 900,
    overlapPct: 0.5,
    centerDistanceMeters: 120,
    ...overrides,
  }) as MergeCandidate;

const MAIN = {
  id: 'sec-a',
  name: 'Main Climb',
  sportTypes: ['Ride'],
  visitCount: 5,
  distanceMeters: 600,
};
const OTHER = {
  id: 'sec-b',
  name: 'Other Climb',
  sportTypes: ['Ride'],
  visitCount: 2,
  distanceMeters: 650,
};

async function open<I, R>(route: string, input: I, Sheet: React.ComponentType) {
  const result = openSheet<I, R>(route, input);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  const tree = await render(<Sheet />);
  return { result, tree };
}

const openCandidates = (candidates: MergeCandidate[]) =>
  open<MergeCandidatesSheetInput, MergeCandidate>(
    'sheets/merge-candidates',
    { candidates },
    MergeCandidatesSheet
  );

const openConfirm = (primary = MAIN, secondary = OTHER) =>
  open<MergeConfirmSheetInput, { primaryId: string; secondaryId: string }>(
    'sheets/merge-confirm',
    { primary, secondary },
    MergeConfirmSheet
  );

const iconNames = () =>
  screen.UNSAFE_getAllByType(MaterialCommunityIcons).map((icon) => icon.props.name as string);

const count = (names: string[], name: string) => names.filter((n) => n === name).length;

beforeAll(async () => {
  await initialiseI18n('en-AU');
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockPreviewDropped.mockReset();
  mockPreviewDropped.mockReturnValue([]);
  mockIsMetric = true;
});

describe('merge candidates sheet', () => {
  it('resolves the caller with the tapped candidate and dismisses', async () => {
    const chosen = candidate({ sectionId: 'sec-c', name: 'Third Climb' });
    const { result } = await openCandidates([candidate(), chosen]);
    await fireEvent.press(screen.getByTestId('merge-candidate-sec-c'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: chosen });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('counts each candidate in traversals', async () => {
    await openCandidates([candidate({ visitCount: 3 })]);
    expect(screen.getByText(/3 traversals/)).toBeTruthy();
  });

  it('cancels when closed without a tap', async () => {
    const { result } = await openCandidates([candidate()]);
    await fireEvent.press(screen.getByTestId('merge-candidates-cancel'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it.each([
    [120, true, /120 m/],
    [3200, true, /3\.2 km/],
    [3200, false, /[\d.]+ mi/],
  ])('shows the centre distance %d m, metric %s', async (metres, metric, expected) => {
    mockIsMetric = metric;
    await openCandidates([candidate({ centerDistanceMeters: metres })]);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await openCandidates([candidate()]);
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('draws every sport of a candidate', async () => {
    await openCandidates([candidate({ sportTypes: ['Ride', 'Run'] })]);
    const names = iconNames();
    expect(count(names, 'bike')).toBe(1);
    expect(count(names, 'run')).toBe(1);
  });
});

describe('merge confirm sheet', () => {
  it('keeps the section with more visits by default and resolves with that direction', async () => {
    const { result } = await openConfirm();
    await fireEvent.press(screen.getByTestId('merge-confirm-merge'));
    await expect(result).resolves.toEqual({
      kind: 'selected',
      value: { primaryId: 'sec-a', secondaryId: 'sec-b' },
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('resolves with the other direction once the other section is chosen', async () => {
    const { result } = await openConfirm();
    await fireEvent.press(screen.getByTestId('merge-keep-sec-b'));
    await fireEvent.press(screen.getByTestId('merge-confirm-merge'));
    await expect(result).resolves.toEqual({
      kind: 'selected',
      value: { primaryId: 'sec-b', secondaryId: 'sec-a' },
    });
  });

  it('cancels without resolving a merge when closed', async () => {
    const { result } = await openConfirm();
    await fireEvent.press(screen.getByTestId('merge-confirm-cancel'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await openConfirm();
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it.each(['ios', 'android'] as const)(
    'keeps Cancel and Merge out of the scrolling list on %s, so they show at the resting detent',
    async (os) => {
      const originalOS = Platform.OS;
      Platform.OS = os;
      try {
        mockPreviewDropped.mockReturnValue(
          Array.from({ length: 6 }, (_, i) => ({
            activityId: `r${i}`,
            name: `Loop ${i}`,
            startDate: 1_700_000_000 + i * 86_400,
          }))
        );
        await openConfirm();
        expect(sheetScrollPlacement(screen.toJSON())).toBe('root');
        const list = within(screen.UNSAFE_getByType(ScrollView));
        expect(list.getByTestId('merge-dropped-rides')).toBeTruthy();
        expect(screen.getByTestId('merge-confirm-merge')).toBeTruthy();
        expect(screen.getByTestId('merge-confirm-cancel')).toBeTruthy();
        if (os === 'android') {
          expect(list.queryByTestId('merge-confirm-merge')).toBeNull();
          expect(list.queryByTestId('merge-confirm-cancel')).toBeNull();
        }
      } finally {
        Platform.OS = originalOS;
      }
    }
  );

  it('shows nothing extra when no ride would leave', async () => {
    await openConfirm();
    expect(screen.queryByTestId('merge-dropped-rides')).toBeNull();
    expect(screen.queryByText(/stay in your library/)).toBeNull();
  });

  it('names the rides that would leave and says they stay in the library', async () => {
    mockPreviewDropped.mockReturnValue([
      { activityId: 'r1', name: 'Morning Spin', startDate: 1_700_000_000 },
      { activityId: 'r2', name: '', startDate: 1_700_100_000 },
    ]);
    await openConfirm();
    expect(screen.getByTestId('merge-dropped-rides')).toBeTruthy();
    expect(
      screen.getByText(/Rides left out of the merged section: 2\. They stay in your library/)
    ).toBeTruthy();
    expect(screen.getByText(/Morning Spin/)).toBeTruthy();
  });

  it('dates each ride that would leave with its year', async () => {
    mockPreviewDropped.mockReturnValue([
      { activityId: 'r1', name: 'Morning Spin', startDate: 1_700_000_000 },
    ]);
    await openConfirm();
    expect(screen.getByText(/Morning Spin, .*2023/)).toBeTruthy();
  });

  it('asks again for the other direction when the choice changes', async () => {
    await openConfirm();
    expect(mockPreviewDropped).toHaveBeenLastCalledWith('sec-a', 'sec-b');
    await fireEvent.press(screen.getByTestId('merge-keep-sec-b'));
    expect(mockPreviewDropped).toHaveBeenLastCalledWith('sec-b', 'sec-a');
  });

  it('no longer promises that all traversal history is preserved', async () => {
    await openConfirm();
    expect(screen.queryByText(/All traversal history/)).toBeNull();
  });

  it('prints each section distance in the athlete unit', async () => {
    mockIsMetric = false;
    await openConfirm({ ...MAIN, distanceMeters: 1287 }, { ...OTHER, distanceMeters: 1287 });
    expect(screen.getAllByText('0.8 mi').length).toBeGreaterThan(0);
    expect(screen.queryByText('1287m')).toBeNull();
  });

  it('counts each section in traversals', async () => {
    await openConfirm();
    expect(screen.getByText(/5 traversals/)).toBeTruthy();
    expect(screen.getByText(/2 traversals/)).toBeTruthy();
  });

  it('draws every sport of each section', async () => {
    await openConfirm(
      { ...MAIN, sportTypes: ['Ride', 'Run'], visitCount: 50 },
      { ...OTHER, sportTypes: ['Walk'], visitCount: 3 }
    );
    const names = iconNames();
    expect(count(names, 'bike')).toBe(1);
    expect(count(names, 'run')).toBe(1);
    expect(count(names, 'walk')).toBe(1);
  });
});
