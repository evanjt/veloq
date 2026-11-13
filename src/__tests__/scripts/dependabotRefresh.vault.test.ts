/**
 * Scenario: a pull_request run tests the branch merged into main as main stood
 * when the run started, and a re-run reuses that merge. A Dependabot pull
 * request that failed on a red main keeps that result after main goes green.
 *
 * Expected behaviour: after a green Test on main, the pull requests asked to
 * rebase are the Dependabot ones whose latest Test run on their head failed
 * and whose branch is behind main, oldest first, a few per run, and never one
 * already asked since that run.
 */

const {
  refreshCandidates,
  MAX_PER_RUN,
  REBASE_COMMAND,
} = require('../../../scripts/lib/dependabot-refresh.js');

const DEPENDABOT = { login: 'app/dependabot', is_bot: true };
const PERSON = { login: 'someone', is_bot: false };

function pr(number: number, overrides: Record<string, unknown> = {}) {
  const head = `head-${number}`;
  return {
    number,
    author: DEPENDABOT,
    headRefOid: head,
    behindBy: 3,
    comments: [],
    latestRun: {
      headSha: head,
      status: 'completed',
      conclusion: 'failure',
      createdAt: '2026-03-07T10:00:00Z',
    },
    ...overrides,
  };
}

describe('refreshCandidates', () => {
  it('selects a Dependabot pull request whose run failed and whose branch is behind main', () => {
    expect(refreshCandidates([pr(87)])).toEqual([87]);
  });

  it('skips one whose latest run passed', () => {
    const passed = pr(91, {
      latestRun: { ...pr(91).latestRun, conclusion: 'success' },
    });
    expect(refreshCandidates([passed])).toEqual([]);
  });

  it('skips one whose latest run is still going', () => {
    const running = pr(91, {
      latestRun: { ...pr(91).latestRun, status: 'in_progress', conclusion: '' },
    });
    expect(refreshCandidates([running])).toEqual([]);
  });

  it('skips one whose branch already holds main', () => {
    expect(refreshCandidates([pr(92, { behindBy: 0 })])).toEqual([]);
  });

  it('skips one with no Test run at all', () => {
    expect(refreshCandidates([pr(93, { latestRun: null })])).toEqual([]);
  });

  it('skips one whose failed run tested an older head', () => {
    expect(refreshCandidates([pr(93, { headRefOid: 'newer-head' })])).toEqual([]);
  });

  it('never selects a pull request a person opened', () => {
    expect(refreshCandidates([pr(94, { author: PERSON })])).toEqual([]);
  });

  it('never selects a bot other than Dependabot', () => {
    expect(
      refreshCandidates([pr(95, { author: { login: 'app/another-bot', is_bot: true } })])
    ).toEqual([]);
  });

  it('skips one already asked to rebase since its run, and asks again after a later run', () => {
    const asked = pr(96, {
      comments: [{ body: `${REBASE_COMMAND}\n`, createdAt: '2026-03-07T11:00:00Z' }],
    });
    const askedBefore = pr(97, {
      comments: [{ body: REBASE_COMMAND, createdAt: '2026-03-06T11:00:00Z' }],
    });
    const otherComment = pr(98, {
      comments: [{ body: 'looks fine', createdAt: '2026-03-07T11:00:00Z' }],
    });
    expect(refreshCandidates([asked, askedBefore, otherComment])).toEqual([97, 98]);
  });

  it('takes the oldest five and leaves the sixth for the next run', () => {
    expect(MAX_PER_RUN).toBe(5);
    const prs = [36, 31, 35, 33, 32, 34].map((n) => pr(n));
    expect(refreshCandidates(prs)).toEqual([31, 32, 33, 34, 35]);
  });

  it('selects nothing from an empty list', () => {
    expect(refreshCandidates([])).toEqual([]);
  });
});
