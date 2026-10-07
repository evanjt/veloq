/**
 * Scenario: the launch sync walks a dozen steps and every page reports it.
 * Expected behaviour: the strip floats over the page and takes no room in it,
 * holds one fixed-size text line whatever the step says, keeps the same mark
 * across steps, and draws nothing once the sync settles.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { SyncProgressStrip } from '@/shared/ui/SyncProgressStrip';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let status: {
  state: SyncState;
  completed?: number;
  total?: number;
  step?: SyncStep;
} = { state: SyncState.Idle };
const listeners: (() => void)[] = [];

function announce(next: typeof status) {
  status = next;
  act(() => listeners.forEach((listener) => listener()));
}

const engine = {
  getSyncStatus: jest.fn(() => status),
  subscribe: jest.fn((_channel: string, listener: () => void) => {
    listeners.push(listener);
    return () => {};
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  listeners.length = 0;
  status = { state: SyncState.Idle };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

test('an idle sync draws nothing', () => {
  const { queryByTestId } = render(<SyncProgressStrip />);

  expect(queryByTestId('sync-progress-strip')).toBeNull();
});

test('the strip floats over the page and never takes layout room', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<SyncProgressStrip />);

  const strip = getByTestId('sync-progress-strip');
  expect(StyleSheet.flatten(strip.props.style).position).toBe('absolute');
  expect(strip.props.pointerEvents).toBe('none');
});

test('the text line has one fixed height and stays on one row', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<SyncProgressStrip />);

  const line = getByTestId('sync-progress-line');
  expect(typeof StyleSheet.flatten(line.props.style).height).toBe('number');
  expect(getByTestId('sync-progress-message').props.numberOfLines).toBe(1);
});

test('a change of step swaps the text and keeps the line and mark in place', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId, getAllByTestId } = render(<SyncProgressStrip />);
  const lineBefore = getByTestId('sync-progress-line');
  const heightBefore = StyleSheet.flatten(lineBefore.props.style).height;

  announce({ state: SyncState.Syncing, completed: 3, total: 8, step: SyncStep.Census });

  expect(getAllByTestId('sync-progress-mark')).toHaveLength(1);
  expect(getByTestId('sync-progress-message').props.children).toBe('settings.syncStep.census');
  expect(StyleSheet.flatten(getByTestId('sync-progress-line').props.style).height).toBe(
    heightBefore
  );
});

test('the counts sit beside the message in a fixed slot', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<SyncProgressStrip />);

  expect(getByTestId('sync-progress-counts').props.children).toBe('2/8');
});

test('the strip goes when the sync settles', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { queryByTestId } = render(<SyncProgressStrip />);
  expect(queryByTestId('sync-progress-strip')).toBeTruthy();

  announce({ state: SyncState.Idle });

  expect(queryByTestId('sync-progress-strip')).toBeNull();
});
