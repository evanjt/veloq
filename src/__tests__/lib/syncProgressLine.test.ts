/**
 * Scenario: the engine's `completed` and `total` count sync steps, the
 * endpoints `perform_sync` walks. The line drawn over them read
 * "{{completed}} of {{total}} activities", so a fresh install still on the
 * profile step said "0 of 7 activities" and the athlete reading it concluded
 * the app was fetching seven activities and had none of them.
 *
 * Expected behaviour: the line names the step the engine says it is on, and
 * the counters beside it are never called activities.
 */

import { SyncState, SyncStep } from 'veloqrs';
import type { SyncStatus } from 'veloqrs';

import { formatSyncProgress } from '@/shared/format/syncProgress';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

/** `t` answers with the key and its variables, so both are assertable. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key) as never;

function status(partial: Partial<SyncStatus>): SyncStatus {
  return {
    state: SyncState.Syncing,
    inFlight: 1,
    completed: 0,
    total: 9,
    ...partial,
  } as SyncStatus;
}

describe('the sync progress line', () => {
  it('names the step the engine is on, with the step count beside it', () => {
    expect(formatSyncProgress(status({ step: SyncStep.Athlete, completed: 0 }), t)).toBe(
      'settings.syncStepProgress:{"label":"settings.syncStep.athlete","completed":0,"total":9}'
    );
  });

  it('names every step the engine can report', () => {
    const named = Object.values(SyncStep)
      .filter((step): step is SyncStep => typeof step === 'number')
      .map((step) => formatSyncProgress(status({ step }), t));

    expect(named).toEqual([
      'settings.syncStepProgress:{"label":"settings.syncStep.athlete","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.sportSettings","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.wellness","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.census","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.activities","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.curves","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.intervalBodies","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.remainingActivities","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.firstActivities","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.recordActivities","completed":0,"total":9}',
      'settings.syncStepProgress:{"label":"settings.syncStep.calendar","completed":0,"total":9}',
    ]);
  });

  /** A window sync declares one step, and "1 of 1" is noise, not progress. */
  it('drops the fraction from a single-step run', () => {
    expect(formatSyncProgress(status({ step: SyncStep.Activities, total: 1 }), t)).toBe(
      'settings.syncStep.activities'
    );
  });

  /** The first sync after an upgrade sits on one step for minutes. */
  it('shows activities done of owed while a per-activity step runs', () => {
    expect(
      formatSyncProgress(
        status({
          step: SyncStep.IntervalBodies,
          completed: 6,
          stepItemsDone: 40,
          stepItemsTotal: 250,
        }),
        t
      )
    ).toBe(
      'settings.syncStepItemsProgress:{"label":"settings.syncStep.intervalBodies","completed":6,"total":9,"itemsDone":40,"itemsTotal":250}'
    );
  });

  it('keeps the step line when the step owes no activities', () => {
    expect(
      formatSyncProgress(
        status({
          step: SyncStep.IntervalBodies,
          completed: 6,
          stepItemsDone: 0,
          stepItemsTotal: 0,
        }),
        t
      )
    ).toBe(
      'settings.syncStepProgress:{"label":"settings.syncStep.intervalBodies","completed":6,"total":9}'
    );
  });

  it('says a sync is running before the first step begins', () => {
    expect(formatSyncProgress(status({ total: 0 }), t)).toBe('settings.syncActivities');
    expect(formatSyncProgress(null, t)).toBe('settings.syncActivities');
  });

  /** An engine newer than the bundle, the case the error banner also carries. */
  it('falls back for a step this build has no string for', () => {
    expect(formatSyncProgress(status({ step: 99 as SyncStep }), t)).toBe('settings.syncActivities');
  });

  /** The defect itself: a step count was read as a count of activities. */
  it('never calls the step counters activities', () => {
    const lines = Object.values(SyncStep)
      .filter((step): step is SyncStep => typeof step === 'number')
      .map((step) => formatSyncProgress(status({ step, completed: 3 }), t));

    for (const line of lines) {
      expect(line).not.toContain('syncActivitiesProgress');
    }
  });
});
