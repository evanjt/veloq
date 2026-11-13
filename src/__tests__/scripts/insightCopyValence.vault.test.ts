/**
 * Scenario: insight cards are built with `t()` in the athlete's language, so a
 * runtime pattern check can only judge the English ones.
 *
 * Expected behaviour: the guard reads the source copy of the insights
 * namespace and fails on a punitive second-person string, naming its key. Other
 * namespaces and the current copy are left alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-insight-valence.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(locale: unknown, base?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'insight-valence-'));
  roots.push(root);
  mkdirSync(join(root, 'src/i18n/locales'), { recursive: true });
  writeFileSync(join(root, 'src/i18n/locales/en-AU.json'), JSON.stringify(locale));
  if (base) writeFileSync(join(root, 'src/i18n/locales/en-GB.json'), JSON.stringify(base));
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('insight copy valence guard', () => {
  it.each([
    ["You haven't ridden this week"],
    ['You have not ridden this week'],
    ["You didn't ride today"],
    ['You failed to match your time'],
    ['You missed the target'],
    ['You are behind schedule'],
    ['Not enough efforts to say'],
  ])('fails on "%s" and names the key', (text) => {
    const { status, output } = runGuard(fixture({ insights: { card: { title: text } } }));
    expect(status).toBe(1);
    expect(output).toContain('insights.card.title');
  });

  it('passes neutral copy', () => {
    const { status } = runGuard(
      fixture({ insights: { card: { title: 'Hill Climb: 3s faster median' } } })
    );
    expect(status).toBe(0);
  });

  it('checks inherited base copy when the regional file has no insights override', () => {
    const { status, output } = runGuard(
      fixture({}, { insights: { card: { title: 'You missed the target' } } })
    );
    expect(status).toBe(1);
    expect(output).toContain('en-GB insights.card.title');
  });

  it('reads only the insights namespace', () => {
    const { status } = runGuard(
      fixture({ insights: { ok: 'Steady' }, other: { x: "You haven't signed in" } })
    );
    expect(status).toBe(0);
  });

  it('leaves the ranking explainer labels alone', () => {
    const { status } = runGuard(
      fixture({ insights: { ranking: { unavailable: 'Not enough valid comparison data' } } })
    );
    expect(status).toBe(0);
  });

  it('refuses a locale with no insights namespace', () => {
    expect(runGuard(fixture({ other: {} })).status).toBe(1);
  });
});
