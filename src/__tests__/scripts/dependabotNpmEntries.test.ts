/**
 * Scenario: an npm entry in dependabot.yml points at a directory whose
 * manifest has no lockfile and only `*` ranges. Dependabot has nothing to bump
 * there, so the entry can never open a pull request, yet it still runs each
 * month and reads as if that directory's dependencies were watched.
 *
 * Expected behaviour: every npm directory dependabot watches has a
 * package-lock.json, or a manifest declaring at least one range other than `*`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const yaml = require('js-yaml') as { load: (source: string) => unknown };

const ROOT = resolve(__dirname, '../../..');

interface Update {
  'package-ecosystem': string;
  directory: string;
}

type Manifest = Record<string, unknown>;

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function npmDirectories(): string[] {
  const config = yaml.load(readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')) as {
    updates: Update[];
  };
  return config.updates
    .filter((update) => update['package-ecosystem'] === 'npm')
    .map((update) => update.directory);
}

/** True when the directory gives dependabot something it could bump. */
function hasBumpableDependencies(dir: string): boolean {
  if (existsSync(join(dir, 'package-lock.json'))) return true;
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  return DEPENDENCY_FIELDS.some((field) =>
    Object.values((manifest[field] ?? {}) as Record<string, string>).some(
      (range) => range.trim() !== '*'
    )
  );
}

describe('dependabot npm entries', () => {
  it('watch only directories with a lockfile or a pinned range', () => {
    const directories = npmDirectories();
    expect(directories.length).toBeGreaterThan(0);
    expect(directories.filter((dir) => !hasBumpableDependencies(join(ROOT, dir)))).toEqual([]);
  });
});
