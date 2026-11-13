/**
 * Scenario: a tap on the heatmap opens a sheet of the activities under it, a
 * formSheet route that answers its caller through the sheet request channel and
 * tells the map which group to draw.
 *
 * Expected behaviour: it lists the groups with their counts, the one-off group
 * last, and the chosen group's activities under them; choosing a group reports
 * it to the map, a tapped activity resolves the caller with its id, and the
 * sheet says how many of a group are drawn when the group is over the cap.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import UnderPointSheet, { type UnderPointInput } from '@/app/sheets/under-point';
import { openSheet } from '@/shared/app/sheetRequest';
import { initialiseI18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

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
  useMetricSystem: () => true,
}));

const activity = (id: string, name: string) => ({
  id,
  name,
  sportType: 'Ride',
  date: 1_700_000_000,
  distance: 20_000,
  duration: 3600,
  nearestM: 4,
});

const GROUPS: UnderPointInput['groups'] = [
  {
    routeId: 'loop',
    name: 'Lake loop',
    count: 2,
    activities: [activity('a', 'Morning spin'), activity('b', 'Evening spin')],
  },
  { routeId: 'hill', number: 4, count: 1, activities: [activity('c', 'Hill repeat')] },
  { count: 3, activities: [activity('d', 'Detour')] },
];

async function open(overrides: Partial<UnderPointInput> = {}) {
  const onGroup = jest.fn();
  const input: UnderPointInput = {
    total: 6,
    traceCap: 20,
    groups: GROUPS,
    onGroup,
    ...overrides,
  };
  const result = openSheet<UnderPointInput, string>('sheets/under-point', input);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<UnderPointSheet />);
  return { result, onGroup };
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('under-point sheet', () => {
  it('lists the total and each group with its count, the one-off group last', async () => {
    await open();
    expect(screen.getByRole('header')).toHaveTextContent('6 activities');
    const groups = screen.getAllByTestId(/^under-point-group-/);
    expect(groups.map((g) => g.props.testID)).toEqual([
      'under-point-group-loop',
      'under-point-group-hill',
      'under-point-group-none',
    ]);
    expect(groups[0]).toHaveTextContent(/Lake loop.*2 activities/);
    expect(groups[1]).toHaveTextContent(/Route 4.*1 activity/);
    expect(groups[2]).toHaveTextContent(/3 activities/);
  });

  it('selects the first group on open when everything fits under the cap', async () => {
    const { onGroup } = await open();
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledWith(GROUPS[0]);
    expect(screen.getByTestId('under-point-activity-a')).toBeTruthy();
    expect(screen.queryByTestId('under-point-activity-c')).toBeNull();
  });

  it('selects nothing on open when the total is over the cap', async () => {
    const { onGroup } = await open({ total: 30, traceCap: 20 });
    expect(onGroup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('under-point-activity-a')).toBeNull();
  });

  it('reports the group chosen and lists its activities', async () => {
    const { onGroup } = await open();
    await fireEvent.press(screen.getByTestId('under-point-group-hill'));
    expect(onGroup).toHaveBeenLastCalledWith(GROUPS[1]);
    expect(screen.getByTestId('under-point-activity-c')).toBeTruthy();
    expect(screen.queryByTestId('under-point-activity-a')).toBeNull();
    expect(screen.getByTestId('under-point-group-hill')).toBeSelected();
    expect(screen.getByTestId('under-point-group-loop')).not.toBeSelected();
  });

  it('says how many of a group are drawn when the group is over the cap', async () => {
    await open({ total: 30, traceCap: 1 });
    await fireEvent.press(screen.getByTestId('under-point-group-loop'));
    expect(screen.getByTestId('under-point-drawn')).toHaveTextContent('1 of 2 drawn');
  });

  it('says nothing about drawing when the group fits under the cap', async () => {
    await open();
    expect(screen.queryByTestId('under-point-drawn')).toBeNull();
  });

  it('resolves the caller with the id of the tapped activity', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('under-point-activity-b'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'b' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('resolves cancelled from its Cancel', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('under-point-cancel'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
