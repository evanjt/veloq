/**
 * Scenario: the launch sync walks a dozen steps, several of them inside a
 * second, and every route reports it.
 * Expected behaviour: the pill passes touches through, draws the status pill on
 * the raised surface with the ring's arc as its only blue, wraps the label
 * while the counts stay whole, keeps each step on screen for a minimum time and
 * cross-fades into the next, and draws nothing once the sync settles.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { SyncPill, SYNC_MESSAGE_HOLD_MS } from '@/shared/ui/SyncPill';
import { getEngine } from '@/shared/native/engine';
import { brand, colors, darkColors, motionPresets, stroke } from '@/theme';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

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

async function announce(next: typeof status) {
  status = next;
  await act(() => listeners.forEach((listener) => listener()));
}

async function wait(ms: number) {
  await act(() => {
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

test('an idle sync draws nothing', async () => {
  const { queryByTestId } = await render(<SyncPill />);

  expect(queryByTestId('sync-progress-pill')).toBeNull();
});

test('the pill passes touches through', async () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = await render(<SyncPill />);

  expect(getByTestId('sync-progress-pill').props.pointerEvents).toBe('none');
});

test.each([
  ['light', false],
  ['dark', true],
])('the pill draws the status pill on the raised surface in %s mode', async (_, isDark) => {
  mockIsDark = isDark;
  const palette = isDark ? darkColors : colors;
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = await render(<SyncPill />);

  const pill = StyleSheet.flatten(getByTestId('sync-progress-pill').props.style);
  expect(pill.backgroundColor).toBe(palette.surfaceRaised);
  const message = StyleSheet.flatten(getByTestId('sync-progress-pill-title').props.style);
  const counts = StyleSheet.flatten(getByTestId('sync-progress-pill-detail').props.style);
  expect(message.color).toBe(palette.textPrimary);
  expect(counts.color).toBe(palette.textSecondary);

  if (isDark) {
    expect(pill.borderWidth).toBe(stroke.one);
    expect(pill.borderColor).toBe(palette.cardEdge);
  } else {
    expect(pill.borderWidth).toBeUndefined();
  }
});

test.each([
  ['light', false],
  ['dark', true],
])(
  'the ring turns in the on colour over the track, the only blue, in %s mode',
  async (_, isDark) => {
    mockIsDark = isDark;
    const palette = isDark ? darkColors : colors;
    status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
    const { getByTestId } = await render(<SyncPill />);

    const ring = StyleSheet.flatten(getByTestId('sync-progress-mark').props.style);
    expect(ring.borderTopColor).toBe(palette.controlOn);
    expect(ring.borderColor).toBe(palette.track);

    const blues = [brand.blue, brand.blueDark].map((c) => c.toLowerCase());
    const drawn = getByTestId('sync-progress-pill')
      .findAll(() => true)
      .flatMap((node) => Object.values(StyleSheet.flatten(node.props.style) ?? {}))
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    for (const blue of blues) expect(drawn).not.toContain(blue);
  }
);

test("neither palette keeps a fill of the sync pill's own", () => {
  expect(colors).not.toHaveProperty('appColourPillBackground');
  expect(darkColors).not.toHaveProperty('appColourPillBackground');
});

test('a long label wraps and the counts stay whole', async () => {
  status = {
    state: SyncState.Syncing,
    completed: 2,
    total: 11,
    step: SyncStep.RemainingActivities,
    stepItemsDone: 1234,
    stepItemsTotal: 5678,
  };
  const { getByTestId } = await render(<SyncPill />);

  const message = getByTestId('sync-progress-pill-title');
  expect(message.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(message.props.style).flexShrink).toBe(1);

  const counts = getByTestId('sync-progress-pill-detail');
  expect(counts.props.children).toBe('2/11 · 1234/5678');
  expect(counts.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(counts.props.style).flexShrink).toBe(0);

  // The pill never grows past the screen's edges, so the label is what wraps.
  const pill = StyleSheet.flatten(getByTestId('sync-progress-pill').props.style);
  expect(pill.maxWidth).toBe('100%');
});

test('a new step cross-fades in at the message duration', async () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.Athlete };
  const { getByTestId } = await render(<SyncPill />);

  const message = getByTestId('sync-progress-pill-title');
  expect(message.props.entering).toBe(motionPresets.message.entering);
  expect(message.props.exiting).toBe(motionPresets.message.exiting);
});

test('a step holds the line for the minimum time when the next arrives sooner', async () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.Athlete };
  const { getByTestId } = await render(<SyncPill />);

  await wait(200);
  await announce({
    state: SyncState.Syncing,
    completed: 2,
    total: 8,
    step: SyncStep.SportSettings,
  });
  await wait(200);
  await announce({ state: SyncState.Syncing, completed: 3, total: 8, step: SyncStep.Wellness });

  expect(getByTestId('sync-progress-pill-title').props.children).toBe('settings.syncStep.athlete');
  expect(getByTestId('sync-progress-pill-detail').props.children).toBe('1/8');

  await wait(SYNC_MESSAGE_HOLD_MS - 400 - 1);
  expect(getByTestId('sync-progress-pill-title').props.children).toBe('settings.syncStep.athlete');

  await wait(1);
  expect(getByTestId('sync-progress-pill-title').props.children).toBe('settings.syncStep.wellness');
  expect(getByTestId('sync-progress-pill-detail').props.children).toBe('3/8');
});

test('a step that outlasts the hold changes the line at once', async () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.Athlete };
  const { getByTestId, getAllByTestId } = await render(<SyncPill />);

  await wait(SYNC_MESSAGE_HOLD_MS + 500);
  await announce({ state: SyncState.Syncing, completed: 3, total: 8, step: SyncStep.Census });

  expect(getAllByTestId('sync-progress-mark')).toHaveLength(1);
  expect(getByTestId('sync-progress-pill-title').props.children).toBe('settings.syncStep.census');
});

test('the item count inside one step follows at once', async () => {
  status = {
    state: SyncState.Syncing,
    completed: 4,
    total: 8,
    step: SyncStep.Activities,
    stepItemsDone: 12,
    stepItemsTotal: 40,
  };
  const { getByTestId } = await render(<SyncPill />);

  await wait(100);
  await announce({ ...status, stepItemsDone: 13 });

  expect(getByTestId('sync-progress-pill-detail').props.children).toBe('4/8 · 13/40');
});

test('a sync that ends inside the hold stays on its last message, then goes', async () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { getByTestId, queryByTestId } = await render(<SyncPill />);

  await wait(300);
  await announce({ state: SyncState.Idle });

  expect(getByTestId('sync-progress-pill-title').props.children).toBe(
    'settings.syncStep.sportSettings'
  );

  await wait(SYNC_MESSAGE_HOLD_MS);
  expect(queryByTestId('sync-progress-pill')).toBeNull();
});

test('a sync that settles after the hold goes at once', async () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { queryByTestId } = await render(<SyncPill />);

  await wait(SYNC_MESSAGE_HOLD_MS);
  await announce({ state: SyncState.Idle });

  expect(queryByTestId('sync-progress-pill')).toBeNull();
});
