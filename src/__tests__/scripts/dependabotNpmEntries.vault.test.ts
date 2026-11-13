/**
 * Scenario: an npm entry in dependabot.yml points at a directory whose
 * manifest has no lockfile and only `*` ranges. Dependabot has nothing to bump
 * there, so the entry can never open a pull request, yet it still runs each
 * month and reads as if that directory's dependencies were watched.
 *
 * Expected behaviour: every npm directory dependabot watches has a
 * package-lock.json, or a manifest declaring at least one range other than `*`.
 *
 * Scenario: a group that takes several packages' minor and patch updates
 * together opens one pull request, and one failing member holds back the rest.
 * Auto-merge arms on the update type the metadata reports, which for a group is
 * one member's, so a patch-reported group can carry a minor or a major unread.
 *
 * Expected behaviour: every group declares its update types; a group of more
 * than one package takes patch updates only, and no group takes majors.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const yaml = require('js-yaml') as { load: (source: string) => unknown };

const ROOT = resolve(__dirname, '../../..');

interface Group {
  patterns?: string[];
  'update-types'?: string[];
}

interface Update {
  'package-ecosystem': string;
  directory: string;
  groups?: Record<string, Group>;
}

type Manifest = Record<string, unknown>;

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function updates(): Update[] {
  const config = yaml.load(readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')) as {
    updates: Update[];
  };
  return config.updates;
}

function npmDirectories(): string[] {
  return updates()
    .filter((update) => update['package-ecosystem'] === 'npm')
    .map((update) => update.directory);
}

/** True when the group names one package exactly, so its PR carries one update. */
function isSinglePackage(group: Group): boolean {
  const patterns = group.patterns ?? [];
  return patterns.length === 1 && !patterns[0].includes('*');
}

/** Why a group could merge an update nobody read, or null when it cannot. */
function groupProblem(group: Group): string | null {
  const types = group['update-types'];
  if (types === undefined) return 'takes every update type, majors included';
  if (types.includes('major')) return 'takes majors';
  if (types.some((type) => type !== 'patch') && !isSinglePackage(group)) {
    return `takes ${types.join(' and ')} updates of several packages together`;
  }
  return null;
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

describe('dependabot groups', () => {
  it('group several packages for patch updates only, and never take majors', () => {
    const problems = updates().flatMap((update) =>
      Object.entries(update.groups ?? {}).flatMap(([name, group]) => {
        const problem = groupProblem(group);
        return problem === null ? [] : [`${update['package-ecosystem']} ${name}: ${problem}`];
      })
    );
    expect(problems).toEqual([]);
  });
});
