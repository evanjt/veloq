/**
 * Scenario: "retention by `created_at`" was cited as one of the ways an
 * activity leaves the device. It never ran: the engine function had no export
 * and no caller outside two tests, the store field had a validating setter and
 * no screen, and a doc comment beside the stream window asserted the opposite,
 * which is what kept the belief alive.
 *
 * Expected behaviour: the path is gone, and nothing claims it is there. The
 * only deletes are the logout wipe and the derived clear.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

function sourceFiles(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    // Tests may still name it to assert it is gone, and the generated
    // bindings mirror whatever the Rust doc comments say.
    if (['node_modules', 'generated', 'target', '__tests__'].includes(entry)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full, match);
    return match.test(entry) ? [full] : [];
  });
}

/** Every file naming `name`, relative to the repository root. */
function filesNaming(name: string, dirs: string[], match: RegExp): string[] {
  return dirs
    .flatMap((dir) => sourceFiles(join(ROOT, dir), match))
    .filter((file) => readFileSync(file, 'utf8').includes(name))
    .map((file) => relative(ROOT, file));
}

describe('activity retention', () => {
  it('is named by no TypeScript outside the stream window it is confused with', () => {
    const naming = filesNaming('retentionDays', ['src', 'modules/veloqrs/src'], /\.tsx?$/);

    expect(naming).toEqual([]);
  });

  it('has no engine function left to call', () => {
    const naming = filesNaming(
      'cleanup_old_activities',
      ['modules/veloqrs/rust/veloqrs/src', 'modules/veloqrs/rust/veloqrs/tests'],
      /\.rs$/
    );

    expect(naming).toEqual([]);
  });

  it('is not pointed at by the stream window, which is a different knob', () => {
    const streamRetention = readFileSync(
      join(ROOT, 'src/features/settings/lib/streamRetention.ts'),
      'utf8'
    );

    // The comment here asserted the activity path existed, which is what kept
    // the belief alive after the path itself stopped being called.
    expect(streamRetention).not.toMatch(/RouteSettingsStore/);
  });
});
