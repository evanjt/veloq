/**
 * Scenario: a pool swim opens on the detail screen, and the screen read says
 * whether its FIT file is still owed, read, or settled with no lengths.
 *
 * Expected behaviour: an owed swim asks for its file once, a read or settled
 * one never does, and the parse landing for this swim re-reads the screen so
 * the lengths appear without leaving it.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PoolSwimState } from 'veloqrs';

import { useActivityDetailData } from '@/features/activity/hooks/useActivityDetailData';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

function detail(poolSwim: unknown) {
  return {
    activityCount: 1,
    sectionCount: 0,
    routeGroups: [],
    matchedSections: [],
    customSections: [],
    encounters: [],
    highlights: { indicators: [], routeHighlights: [], newGround: [], strengthCards: [] },
    sectionTraces: [],
    prSectionIds: [],
    poolSwim,
  };
}

const owed = { state: PoolSwimState.Owed, lengths: [], strokeTotals: [] };
const read = {
  state: PoolSwimState.Read,
  poolLengthM: 25,
  lengths: [{ index: 0, active: true, swolf: 43 }],
  strokeTotals: [],
};
const settled = { state: PoolSwimState.NoLengths, lengths: [], strokeTotals: [] };

/** An engine whose detail read answers `answer()` and records its listeners. */
function fakeEngine(answer: () => unknown) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const engine = {
    getActivityDetailData: jest.fn(() => answer()),
    fetchAndParseExerciseSets: jest.fn(),
    subscribe: jest.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((held) => held !== listener)
        );
      };
    }),
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
  mockGetEngine.mockReturnValue(engine);
  return engine;
}

function Probe({ id }: { id: string }) {
  const { data } = useActivityDetailData(id, true);
  return <Text testID="state">{String(data?.poolSwim?.state ?? 'none')}</Text>;
}

describe('the activity detail read of a pool swim', () => {
  afterEach(() => mockGetEngine.mockReset());

  it('asks once for the file of a swim whose lengths are owed', async () => {
    const engine = fakeEngine(() => detail(owed));

    const screen = await render(<Probe id="swim" />);
    await screen.rerender(<Probe id="swim" />);

    expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1);
    expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledWith('swim');
  });

  it('does not ask again when a re-read still finds the file owed', async () => {
    const engine = fakeEngine(() => detail(owed));
    await render(<Probe id="swim" />);

    await act(async () => engine.emit('bodyStored', { kind: 'streams', activityId: 'swim' }));

    expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['read', read],
    ['settled with no lengths', settled],
    ['not a pool swim', undefined],
  ])('never asks for the file of a swim %s', async (_name, poolSwim) => {
    const engine = fakeEngine(() => detail(poolSwim));

    await render(<Probe id="swim" />);

    expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
  });

  it('re-reads when the file of this swim is parsed, and not for another', async () => {
    let answer: unknown = owed;
    const engine = fakeEngine(() => detail(answer));
    const screen = await render(<Probe id="swim" />);
    expect(screen.getByTestId('state')).toHaveTextContent(String(PoolSwimState.Owed));

    answer = read;
    await act(async () => engine.emit('fitParsed', { activityId: 'other' }));
    expect(screen.getByTestId('state')).toHaveTextContent(String(PoolSwimState.Owed));

    await act(async () => engine.emit('fitParsed', { activityId: 'swim' }));
    expect(screen.getByTestId('state')).toHaveTextContent(String(PoolSwimState.Read));
  });
});
