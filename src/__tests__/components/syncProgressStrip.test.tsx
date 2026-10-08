/**
 * Scenario: the launch sync walks a dozen steps, several of them inside a
 * second, and every tab reports it.
 * Expected behaviour: the pill floats at the top under the safe-area inset and
 * takes no room in the page, fills from its own theme token, holds one line
 * whatever the step says with the counts kept whole, keeps each step on screen
 * for a minimum time, and draws nothing once the sync settles.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { SyncProgressStrip, SYNC_MESSAGE_HOLD_MS } from '@/shared/ui/SyncProgressStrip';
import { getEngine } from '@/shared/native/engine';
import { colors, darkColors } from '@/theme';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const TOP_INSET = 47;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 24, left: 0, right: 0 }),
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let status: {
  state: SyncState;
  completed?: number;
  total?: number;
  step?: SyncStep;
  stepItemsDone?: number;
  stepItemsTotal?: number;
} = { state: SyncState.Idle };
const listeners: (() => void)[] = [];

function announce(next: typeof status) {
  status = next;
  act(() => listeners.forEach((listener) => listener()));
}

function wait(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

const engine = {
  getSyncStatus: jest.fn(() => status),
  subscribe: jest.fn((_channel: string, listener: () => void) => {
    listeners.push(listener);
    return () => {};
  }),
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.length = 0;
  mockIsDark = false;
  status = { state: SyncState.Idle };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  jest.useRealTimers();
});

test('an idle sync draws nothing', () => {
  const { queryByTestId } = render(<SyncProgressStrip />);

  expect(queryByTestId('sync-progress-strip')).toBeNull();
});

test('the pill floats at the top under the safe-area inset and passes touches through', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<SyncProgressStrip />);

  const strip = getByTestId('sync-progress-strip');
  const style = StyleSheet.flatten(strip.props.style);
  expect(style.position).toBe('absolute');
  expect(style.bottom).toBeUndefined();
  expect(style.top).toBeGreaterThanOrEqual(TOP_INSET);
  expect(strip.props.pointerEvents).toBe('none');
});

test.each([
  ['light', false],
  ['dark', true],
])('the pill takes its fill from the token and draws white on it in %s mode', (_, isDark) => {
  mockIsDark = isDark;
  const palette = isDark ? darkColors : colors;
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<SyncProgressStrip />);

  const pill = StyleSheet.flatten(getByTestId('sync-progress-pill').props.style);
  expect(pill.backgroundColor).toBe(palette.appColourPillBackground);
  const message = StyleSheet.flatten(getByTestId('sync-progress-message').props.style);
  const counts = StyleSheet.flatten(getByTestId('sync-progress-counts').props.style);
  expect(message.color).toBe(colors.textOnDark);
  expect(counts.color).toBe(colors.textOnDark);
});

test('a long label keeps to one line and gives way before the counts do', () => {
  status = {
    state: SyncState.Syncing,
    completed: 2,
    total: 11,
    step: SyncStep.RemainingActivities,
    stepItemsDone: 1234,
    stepItemsTotal: 5678,
  };
  const { getByTestId } = render(<SyncProgressStrip />);

  const message = getByTestId('sync-progress-message');
  expect(message.props.numberOfLines).toBe(1);
  expect(message.props.ellipsizeMode).toBe('tail');
  expect(StyleSheet.flatten(getByTestId('sync-progress-line').props.style).flexShrink).toBe(1);

  const counts = getByTestId('sync-progress-counts');
  expect(counts.props.children).toBe('2/11 · 1234/5678');
  expect(StyleSheet.flatten(counts.props.style).flexShrink).toBe(0);

  // The pill never grows past the screen's edges, so the label is what shrinks.
  const pill = StyleSheet.flatten(getByTestId('sync-progress-pill').props.style);
  expect(pill.maxWidth).toBe('100%');
});

test('a step holds the line for the minimum time when the next arrives sooner', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.Athlete };
  const { getByTestId } = render(<SyncProgressStrip />);

  wait(200);
  announce({ state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.SportSettings });
  wait(200);
  announce({ state: SyncState.Syncing, completed: 3, total: 8, step: SyncStep.Wellness });

  expect(getByTestId('sync-progress-message').props.children).toBe('settings.syncStep.athlete');
  expect(getByTestId('sync-progress-counts').props.children).toBe('1/8');

  wait(SYNC_MESSAGE_HOLD_MS - 400 - 1);
  expect(getByTestId('sync-progress-message').props.children).toBe('settings.syncStep.athlete');

  wait(1);
  expect(getByTestId('sync-progress-message').props.children).toBe('settings.syncStep.wellness');
  expect(getByTestId('sync-progress-counts').props.children).toBe('3/8');
});

test('a step that outlasts the hold changes the line at once', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.Athlete };
  const { getByTestId, getAllByTestId } = render(<SyncProgressStrip />);
  const heightBefore = StyleSheet.flatten(getByTestId('sync-progress-line').props.style).height;

  wait(SYNC_MESSAGE_HOLD_MS + 500);
  announce({ state: SyncState.Syncing, completed: 3, total: 8, step: SyncStep.Census });

  expect(getAllByTestId('sync-progress-mark')).toHaveLength(1);
  expect(getByTestId('sync-progress-message').props.children).toBe('settings.syncStep.census');
  expect(StyleSheet.flatten(getByTestId('sync-progress-line').props.style).height).toBe(
    heightBefore
  );
});

test('the item count inside one step follows at once', () => {
  status = {
    state: SyncState.Syncing,
    completed: 4,
    total: 8,
    step: SyncStep.Activities,
    stepItemsDone: 12,
    stepItemsTotal: 40,
  };
  const { getByTestId } = render(<SyncProgressStrip />);

  wait(100);
  announce({ ...status, stepItemsDone: 13 });

  expect(getByTestId('sync-progress-counts').props.children).toBe('4/8 · 13/40');
});

test('a sync that ends inside the hold stays on its last message, then goes', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { getByTestId, queryByTestId } = render(<SyncProgressStrip />);

  wait(300);
  announce({ state: SyncState.Idle });

  expect(getByTestId('sync-progress-message').props.children).toBe(
    'settings.syncStep.sportSettings'
  );

  wait(SYNC_MESSAGE_HOLD_MS);
  expect(queryByTestId('sync-progress-strip')).toBeNull();
});

test('a sync that settles after the hold goes at once', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { queryByTestId } = render(<SyncProgressStrip />);

  wait(SYNC_MESSAGE_HOLD_MS);
  announce({ state: SyncState.Idle });

  expect(queryByTestId('sync-progress-strip')).toBeNull();
});
