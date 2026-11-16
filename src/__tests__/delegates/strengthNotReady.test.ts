/**
 * Scenario: a strength read or write arrives while the engine is closed.
 *
 * Expected behaviour: every export answers its empty default, a start answers
 * NotReady and a write is held rather than reaching a null engine.
 */

import * as strength from '../../../modules/veloqrs/src/delegates/strength';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import { FfiStartOutcome } from '../../../modules/veloqrs/src/generated/veloqrs';

function closedHost() {
  const held: string[] = [];
  const host = {
    ready: false,
    get engine(): never {
      throw new TypeError("Cannot read property 'strength' of null");
    },
    timed: <T>(_name: string, run: () => T) => run(),
    write: (name: string) => {
      held.push(name);
    },
  } as unknown as DelegateHost;
  return { host, held };
}

describe('the strength delegate with the engine closed', () => {
  const { host, held } = closedHost();

  it('answers every read with its empty default', () => {
    expect(strength.getExerciseSets(host, 'a1').sets).toEqual([]);
    expect(strength.isFitProcessed(host, 'a1')).toBe(false);
    expect(strength.getMuscleGroups(host, 'a1')).toEqual([]);
    expect(strength.getUnprocessedStrengthIds(host)).toEqual([]);
    expect(strength.hasStrengthData(host)).toBe(false);
    const screen = strength.getStrengthScreenData(host, 0, 1, [{ startTs: 0, endTs: 1 }]);
    expect(screen.summary.muscleVolumes).toEqual([]);
    expect(screen.weekly).toEqual([]);
    expect(screen.exercises).toEqual([]);
    expect(screen.owedCount).toBe(0);
    expect(strength.getMuscleDetail(host, 'a1', 'chest')).toBeNull();
  });

  it('answers the recorder reads with nothing and its writes with null', () => {
    expect(strength.getStrengthStartData(host, 0)).toEqual({
      live: false,
      groups: [],
      workouts: [],
    });
    expect(strength.getLiveStrengthSession(host)).toBeNull();
    expect(strength.startLiveStrengthSession(host, { kind: 'Blank' }, 0)).toBeNull();
    expect(strength.startLiveStrengthSessionFromPlan(host, ['Plank 60 sec'], 0)).toBeNull();
    expect(strength.editLiveStrengthSession(host, { kind: 'StartRest' }, 0)).toBeNull();
  });

  it('answers NotReady from both starts', () => {
    expect(strength.fetchAndParseExerciseSets(host, 'a1')).toEqual({
      outcome: FfiStartOutcome.NotReady,
    });
    expect(strength.batchFetchOwedFitFiles(host)).toEqual({
      outcome: FfiStartOutcome.NotReady,
    });
  });

  it('holds a bulk insert instead of reaching the engine', () => {
    strength.bulkInsertExerciseSets(host, 'a1', []);
    strength.discardLiveStrengthSession(host);
    expect(held).toEqual(['bulkInsertExerciseSets', 'discardLiveStrengthSession']);
  });
});
