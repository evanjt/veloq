/**
 * Scenario: the activity bar rests on the settings screens once any job has
 * run, and each job's row says when it last ran, how many it handled and what
 * changed. The figures come from the engine's background jobs screen read.
 *
 * Expected behaviour: the screen read is taken on the channels that move it and
 * never on the 500 ms progress tick.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { routesStatus } from '../../__shared__/routesStatusStub';
import { BackgroundJobsActivityBar } from '@/features/settings/components/BackgroundJobsActivityBar';
import { getEngine } from '@/shared/native/engine';
import { initializeI18n, changeLanguage } from '@/i18n';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes', () => ({ getPhaseDisplayName: (phase: string) => phase }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface Run {
  job: string;
  finishedAt: number;
  outcome: string;
  handled: number;
  added: number;
  changed: number;
  retired: number;
  failed: number;
}

function run(job: string, over: Partial<Run> = {}): Run {
  return {
    job,
    finishedAt: Date.now() - 60_000,
    outcome: 'complete',
    handled: 0,
    added: 0,
    changed: 0,
    retired: 0,
    failed: 0,
    ...over,
  };
}

let runs: Run[];
let screenReads: number;
const listeners = new Map<string, Set<() => void>>();

function engine() {
  return {
    getRoutesStatusData: () => routesStatus({}),
    getBackgroundJobsData: () => {
      screenReads += 1;
      return { runs, detectionAwaiting: 0, cutoverOwed: false };
    },
    subscribe: (event: string, callback: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(callback);
      listeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

function emit(event: string) {
  act(() => {
    listeners.get(event)?.forEach((callback) => callback());
  });
}

describe('background jobs last run', () => {
  beforeAll(async () => {
    await initializeI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
    jest.useFakeTimers();
    runs = [];
    screenReads = 0;
    listeners.clear();
    mockGetEngine.mockImplementation(() => engine());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rests collapsed with a finished detection run and shows its counts when expanded', () => {
    runs = [run('detection', { handled: 77, added: 3, changed: 1 })];
    const tree = render(<BackgroundJobsActivityBar />);

    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();
    expect(tree.queryByTestId('background-job-detection')).toBeNull();

    fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    const line = tree.getByTestId('background-job-detection-last-run').props.children as string;
    expect(line).toContain('77 activities');
    expect(line).toContain('3 new, 1 changed');
    expect(tree.queryByTestId('background-job-cutover')).toBeNull();
  });

  it('says no change when a complete run changed nothing', () => {
    runs = [run('streamBackfill', { handled: 12 })];
    const tree = render(<BackgroundJobsActivityBar />);

    fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    const line = tree.getByTestId('background-job-streamBackfill-last-run').props
      .children as string;
    expect(line).toContain('12 activities');
    expect(line).toContain('No change');
  });

  it('says so when a run stopped early, and names its failures', () => {
    runs = [run('elevationBackfill', { outcome: 'failed', handled: 9, added: 4, failed: 5 })];
    const tree = render(<BackgroundJobsActivityBar />);

    fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    const line = tree.getByTestId('background-job-elevationBackfill-last-run').props
      .children as string;
    expect(line).toContain('Stopped early');
    expect(line).toContain('4 new, 5 failed');
    expect(line).not.toContain('No change');
  });

  it('renders nothing when no job has run and nothing is owed', () => {
    const tree = render(<BackgroundJobsActivityBar />);
    expect(tree.queryByTestId('background-jobs-activity')).toBeNull();
  });

  it('reads the screen read again when detection applies, and never on the tick', () => {
    const tree = render(<BackgroundJobsActivityBar />);
    expect(tree.queryByTestId('background-jobs-activity')).toBeNull();
    const afterMount = screenReads;

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screenReads).toBe(afterMount);

    runs = [run('detection', { handled: 5, added: 2 })];
    emit('detectionApplied');

    expect(screenReads).toBeGreaterThan(afterMount);
    fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-detection-last-run').props.children).toContain('2 new');
  });

  it.each(['activities', 'backfillPhase', 'streamBackfillPhase', 'cutoverSettled'])(
    'reads the screen read again on %s',
    (channel) => {
      render(<BackgroundJobsActivityBar />);
      const before = screenReads;
      emit(channel);
      expect(screenReads).toBeGreaterThan(before);
    }
  );
});
