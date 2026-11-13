/**
 * Scenario: an npm script that runs Jest passes a flag the installed Jest no
 * longer accepts, as `--testPathPattern` became `--testPathPatterns` in Jest 30.
 * Jest refuses the whole command line and exits 1 before running a test, so the
 * script that CI calls fails without saying any suite failed, and one run by
 * hand selects nothing.
 *
 * Expected behaviour: every script's Jest arguments pass the installed Jest's
 * own argument validation, and every script that narrows by test path selects
 * at least one suite.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const { buildArgv } = require('jest-cli') as {
  buildArgv: (argv: string[]) => Promise<unknown>;
};

interface JestCommand {
  script: string;
  env: Record<string, string>;
  args: string[];
}

const ENV_ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

/** Every `jest` invocation in package.json's scripts, with its leading env assignments. */
function jestCommands(): JestCommand[] {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<
    string,
    string
  >;
  const commands: JestCommand[] = [];
  for (const [script, line] of Object.entries(scripts)) {
    for (const segment of line.split(/&&|\|\||;/)) {
      const words = segment.trim().split(/\s+/);
      const env: Record<string, string> = {};
      while (words.length > 0 && ENV_ASSIGNMENT.test(words[0])) {
        const [, name, value] = ENV_ASSIGNMENT.exec(words.shift()!)!;
        env[name] = value;
      }
      if (words[0] === 'npx') words.shift();
      if (words[0] === 'jest') commands.push({ script, env, args: words.slice(1) });
    }
  }
  return commands;
}

/** The suites a script's arguments select, without the flags that write files or watch. */
function listTests({ env, args }: JestCommand): string[] {
  const selection = args.filter((arg) => !/^--(outputFile|json|watch|verbose)\b/.test(arg));
  const out = execFileSync(
    process.execPath,
    [require.resolve('jest/bin/jest'), ...selection, '--listTests'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return out.split('\n').filter((line) => line.startsWith('/'));
}

const commands = jestCommands();
const narrowed = commands.filter(({ args }) => args.some((arg) => arg.startsWith('--testPath')));

describe('the npm scripts that run Jest', () => {
  it('finds the scripts it checks', () => {
    expect(commands.map(({ script }) => script)).toContain('test');
    expect(narrowed.length).toBeGreaterThan(0);
  });

  it.each(commands.map((command) => [command.script, command]))(
    '%s passes arguments the installed Jest accepts',
    async (_script, command) => {
      await expect(buildArgv((command as JestCommand).args)).resolves.toBeDefined();
    }
  );

  it.each(narrowed.map((command) => [command.script, command]))(
    '%s selects at least one suite',
    (_script, command) => {
      expect(listTests(command as JestCommand).length).toBeGreaterThan(0);
    }
  );
});
