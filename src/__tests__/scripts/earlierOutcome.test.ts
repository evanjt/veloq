/**
 * Scenario: a weekly workflow keeps the outcome of a sha in the run history,
 * which outlives the cache a weekly record fell out of.
 *
 * Expected behaviour: the newest earlier run that measured decides, and a run
 * that skipped or cancelled its measurement decides nothing.
 */

const { earlierOutcome, MEASURING_STEP } = require('../../../scripts/lib/earlier-outcome.js');

type Conclusion = 'success' | 'failure' | 'skipped' | 'cancelled' | null;

function run(id: number, at: string, conclusion: Conclusion) {
  return {
    id,
    created_at: at,
    jobs: [
      {
        steps: [
          { name: 'Checkout repository', conclusion: 'success' },
          { name: MEASURING_STEP, conclusion },
        ],
      },
    ],
  };
}

describe('earlierOutcome', () => {
  it('is none when no run is on the sha', () => {
    expect(earlierOutcome([], 9)).toBeNull();
  });

  it('is the conclusion of an earlier green run', () => {
    expect(earlierOutcome([run(1, '2026-09-28T04:10:00Z', 'success')], 9)).toBe('success');
  });

  it('keeps a red run red when a skipped run sits on top of it', () => {
    const runs = [
      run(1, '2026-09-21T04:10:00Z', 'failure'),
      run(2, '2026-09-28T04:10:00Z', 'skipped'),
    ];
    expect(earlierOutcome(runs, 9)).toBe('failure');
  });

  it('measures again after a cancelled measurement', () => {
    expect(earlierOutcome([run(1, '2026-09-21T04:10:00Z', 'cancelled')], 9)).toBeNull();
  });

  it('lets a green dispatch supersede a red run', () => {
    const runs = [
      run(2, '2026-09-23T10:00:00Z', 'success'),
      run(1, '2026-09-21T04:10:00Z', 'failure'),
    ];
    expect(earlierOutcome(runs, 9)).toBe('success');
  });

  it('ignores the run in progress', () => {
    const runs = [run(9, '2026-09-28T04:10:00Z', null), run(1, '2026-09-21T04:10:00Z', 'success')];
    expect(earlierOutcome(runs, 9)).toBe('success');
    expect(earlierOutcome([run(9, '2026-09-28T04:10:00Z', 'failure')], 9)).toBeNull();
  });

  it('ignores a run whose jobs never reached the measuring step', () => {
    expect(earlierOutcome([{ id: 1, created_at: '2026-09-21T04:10:00Z', jobs: [] }], 9)).toBeNull();
  });
});
