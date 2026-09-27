/**
 * Scenario: `npm test` runs the `app` project and `npm run test:tooling` the
 * `tooling` one, split by the list in config/jest.tooling.js. A suite that
 * matched neither project would run nowhere and say nothing, and a guard over a
 * script left in `app` would bring back the cost the split exists to remove.
 *
 * Expected behaviour: every suite Jest finds is in exactly one project, every
 * suite whose code names a path under scripts/, config/, .husky/, .github/ or
 * .maestro/ is in `tooling`, and every suite the list names exists.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const CONFIG = join(ROOT, 'config/jest.config.js');
const { toolingSuites } = require(join(ROOT, 'config/jest.tooling.js')) as {
  toolingSuites: string[];
};

/** A repository path under a tooling directory, written as code rather than prose. */
const NAMES_TOOLING = /(\.\.\/|['"`])(scripts|config|\.husky|\.github|\.maestro)(\/|['"`])/;

function listTests(...args: string[]): string[] {
  const out = execFileSync(
    process.execPath,
    [require.resolve('jest/bin/jest'), '--config', CONFIG, '--listTests', ...args],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  return out
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((path) => relative(ROOT, path))
    .sort();
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the app and tooling projects', () => {
  const all = listTests();
  const app = listTests('--selectProjects', 'app');
  const tooling = listTests('--selectProjects', 'tooling');

  it('puts every suite in exactly one project', () => {
    expect(app.filter((suite) => tooling.includes(suite))).toEqual([]);
    expect([...app, ...tooling].sort()).toEqual(all);
    expect(app.length).toBeGreaterThan(0);
    expect(tooling.length).toBeGreaterThan(0);
  });

  it('leaves no suite that names a tooling path in app', () => {
    const misplaced = app.filter((suite) =>
      NAMES_TOOLING.test(withoutComments(readFileSync(join(ROOT, suite), 'utf8')))
    );

    expect(misplaced).toEqual([]);
  });

  it('names only suites that exist', () => {
    expect(toolingSuites.filter((suite) => !existsSync(join(ROOT, suite)))).toEqual([]);
  });
});
