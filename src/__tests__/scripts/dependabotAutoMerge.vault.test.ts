// Scenario: Dependabot opens a pull request and the auto-merge workflow decides
// whether to arm auto-merge on it.
// Expected behaviour: only a semver-patch update arms it. A semver-minor of a
// 0.x crate or package is a breaking API change, and a grouped update reports
// the version of one member only, so no version check can make a minor safe.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = { name?: string; id?: string; uses?: string; if?: string; run?: string };
type Workflow = { jobs: Record<string, { steps: Step[] }> };

const workflow = yaml.load(
  readFileSync(join(ROOT, '.github/workflows/dependabot-auto-merge.yml'), 'utf8')
) as Workflow;
const steps = workflow.jobs.automerge.steps;
const mergeStep = steps.find((step) => step.run?.includes('gh pr merge --auto'));

/**
 * Evaluates the subset of the GitHub Actions expression language a step
 * condition here uses: string literals, `steps.<id>.outputs.<name>`, `==`, `!=`,
 * `!`, `&&`, `||`, parentheses and `startsWith`. Anything else throws, so a
 * condition written outside the subset fails the test rather than passing it.
 */
function evaluate(expression: string, outputs: Record<string, string>): boolean {
  const tokens =
    expression
      .replace(/^\s*\$\{\{|\}\}\s*$/g, '')
      .match(/'(?:[^']|'')*'|==|!=|&&|\|\||[()!,]|[A-Za-z_][\w.-]*|\S/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected?: string) => {
    const token = tokens[at++];
    if (expected !== undefined && token !== expected) {
      throw new Error(`Expected ${expected} at token ${at} of: ${expression}`);
    }
    return token;
  };

  type Value = string | boolean;
  const truthy = (value: Value) => value !== '' && value !== false;

  const primary = (): Value => {
    const token = take();
    if (token === undefined) throw new Error(`Unexpected end of: ${expression}`);
    if (token === '(') {
      const value = or();
      take(')');
      return value;
    }
    if (token === '!') return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (token === 'startsWith') {
      take('(');
      const subject = String(or());
      take(',');
      const prefix = String(or());
      take(')');
      return subject.toLowerCase().startsWith(prefix.toLowerCase());
    }
    const output = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(token);
    if (output) return outputs[`${output[1]}.${output[2]}`] ?? '';
    throw new Error(`Unsupported token ${token} in: ${expression}`);
  };
  const comparison = (): Value => {
    let left = primary();
    while (peek() === '==' || peek() === '!=') {
      const op = take();
      const right = primary();
      const equal = String(left).toLowerCase() === String(right).toLowerCase();
      left = op === '==' ? equal : !equal;
    }
    return left;
  };
  const and = (): Value => {
    let left = comparison();
    while (peek() === '&&') {
      take();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = (): Value => {
    let left = and();
    while (peek() === '||') {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };

  const result = or();
  if (at !== tokens.length) throw new Error(`Trailing tokens in: ${expression}`);
  return truthy(result);
}

function arms(updateType: string, previousVersion: string, newVersion: string): boolean {
  if (!mergeStep?.if) throw new Error('The auto-merge step has no condition');
  return evaluate(mergeStep.if, {
    'meta.update-type': `version-update:${updateType}`,
    'meta.previous-version': previousVersion,
    'meta.new-version': newVersion,
  });
}

describe('Dependabot auto-merge', () => {
  it('has one step that arms auto-merge, behind the metadata step', () => {
    expect(mergeStep).toBeDefined();
    const meta = steps.find((step) => step.uses?.startsWith('dependabot/fetch-metadata@'));
    expect(meta?.id).toBe('meta');
    expect(steps.indexOf(meta!)).toBeLessThan(steps.indexOf(mergeStep!));
  });

  it('does not arm on a semver-minor of a 0.x dependency', () => {
    expect(arms('semver-minor', '0.21.1', '0.22.0')).toBe(false);
    expect(arms('semver-minor', '0.22.1', '0.23.0')).toBe(false);
  });

  it('does not arm on a semver-minor at all, since a group reports one member', () => {
    expect(arms('semver-minor', '1.4.0', '1.5.0')).toBe(false);
    expect(arms('semver-minor', '', '')).toBe(false);
  });

  it('does not arm on a semver-major', () => {
    expect(arms('semver-major', '1.4.0', '2.0.0')).toBe(false);
    expect(arms('semver-major', '0.9.3', '1.0.0')).toBe(false);
  });

  it('arms on a semver-patch, including one inside a 0.x series', () => {
    expect(arms('semver-patch', '1.4.0', '1.4.1')).toBe(true);
    expect(arms('semver-patch', '0.22.0', '0.22.1')).toBe(true);
  });

  it('does not arm when the metadata step reports no update type', () => {
    expect(
      evaluate(mergeStep!.if!, {
        'meta.previous-version': '0.21.1',
        'meta.new-version': '0.21.2',
      })
    ).toBe(false);
  });
});
