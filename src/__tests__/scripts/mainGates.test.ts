/**
 * Scenario: a tag starts Release, and neither Test nor the E2E gate runs for a
 * tag, so the release reads what those concluded on main for the sha. The
 * gate is a job of the Build workflow, which also builds the production app it
 * tests, so Build's run of the push stands for it.
 *
 * Expected behaviour: a sha passes only when the newest push run of each gate
 * on main concluded success. A run that concluded otherwise is named by its
 * url, a run still going is pending, and a gate with no run is missing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const { GATES, judgeMainGates } = require('../../../scripts/lib/main-gates.js');

type Run = { status: string; conclusion: string | null; created_at: string; html_url: string };

function run(
  conclusion: string | null,
  options: { status?: string; at?: string; id?: number } = {}
): Run {
  const { status = 'completed', at = '2026-10-30T10:00:00Z', id = 1 } = options;
  return {
    status,
    conclusion,
    created_at: at,
    html_url: `https://example.test/actions/runs/${id}`,
  };
}

describe('judgeMainGates', () => {
  it('passes when the newest run of each gate concluded success', () => {
    expect(judgeMainGates({ 'test.yml': [run('success')], 'build.yml': [run('success')] })).toEqual(
      { failed: [], pending: [], missing: [] }
    );
  });

  it('names a failed run by its url', () => {
    const verdict = judgeMainGates({
      'test.yml': [run('failure', { id: 7 })],
      'build.yml': [run('success')],
    });
    expect(verdict.failed).toEqual([
      'test.yml run https://example.test/actions/runs/7 concluded failure',
    ]);
  });

  it('refuses a gate whose run was skipped or cancelled', () => {
    for (const conclusion of ['skipped', 'cancelled']) {
      const verdict = judgeMainGates({
        'test.yml': [run('success')],
        'build.yml': [run(conclusion)],
      });
      expect(verdict.failed).toHaveLength(1);
      expect(verdict.failed[0]).toContain(`concluded ${conclusion}`);
    }
  });

  it('judges the newest run, so a later success clears an earlier failure', () => {
    const verdict = judgeMainGates({
      'test.yml': [
        run('failure', { at: '2026-10-30T09:00:00Z', id: 1 }),
        run('success', { at: '2026-10-30T11:00:00Z', id: 2 }),
      ],
      'build.yml': [run('success')],
    });
    expect(verdict.failed).toEqual([]);
  });

  it('judges the newest run, so a later failure stands against an earlier success', () => {
    const verdict = judgeMainGates({
      'test.yml': [
        run('success', { at: '2026-10-30T09:00:00Z', id: 1 }),
        run('failure', { at: '2026-10-30T11:00:00Z', id: 2 }),
      ],
      'build.yml': [run('success')],
    });
    expect(verdict.failed).toEqual([
      'test.yml run https://example.test/actions/runs/2 concluded failure',
    ]);
  });

  it('holds a run still going as pending, not failed', () => {
    const verdict = judgeMainGates({
      'test.yml': [run(null, { status: 'in_progress' })],
      'build.yml': [run('success')],
    });
    expect(verdict).toEqual({ failed: [], pending: ['test.yml'], missing: [] });
  });

  it('names a gate with no run on the sha as missing', () => {
    const verdict = judgeMainGates({ 'test.yml': [run('success')] });
    expect(verdict).toEqual({ failed: [], pending: [], missing: ['build.yml'] });
  });

  it('reads the two gate workflows that exist in the repository', () => {
    for (const gate of GATES) {
      expect(existsSync(join(__dirname, '../../../.github/workflows', gate))).toBe(true);
    }
  });
});
