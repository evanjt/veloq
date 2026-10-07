/**
 * Scenario: under `noUncheckedIndexedAccess` a type that resolves differently between the
 * main checkout and a worktree reports an assignability error that names no `undefined`.
 *
 * Expected behaviour: only errors the flag can cause by making an index read `undefined`
 * are counted, so the same tree counts the same in both checkouts.
 */

import { execFileSync } from 'child_process';
import { join } from 'path';

const MODULE = join(__dirname, '../../../scripts/lib/uncheckedIndexErrors.mjs');

const isIndexAccessError = (diagnostic: string): boolean =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { isIndexAccessError } from ${JSON.stringify(MODULE)};
         console.log(JSON.stringify(isIndexAccessError(process.argv[1])));`,
        diagnostic,
      ],
      { encoding: 'utf8' }
    )
  );

const line = (code: string, message: string) =>
  `src/shared/charts/example.ts(484,5): error ${code}: ${message}`;

describe('isIndexAccessError', () => {
  it.each(['TS2532', 'TS18048', 'TS2538', 'TS7053'])('counts %s', (code) => {
    expect(isIndexAccessError(line(code, "'items[0]' is possibly 'undefined'."))).toBe(true);
  });

  it('counts an assignability error that names undefined', () => {
    expect(
      isIndexAccessError(
        line('TS2345', "Argument of type 'number | undefined' is not assignable to type 'number'.")
      )
    ).toBe(true);
    expect(
      isIndexAccessError(
        line('TS2322', "Type 'string | undefined' is not assignable to type 'string'.")
      )
    ).toBe(true);
  });

  it('ignores an assignability error between types that resolve differently', () => {
    expect(
      isIndexAccessError(
        line(
          'TS2322',
          "Type 'AnimatedStyleHandle<DefaultStyle>' is not assignable to type 'AnimatedStyle<ViewStyle>'."
        )
      )
    ).toBe(false);
  });

  it('ignores a line that is not a diagnostic and an unrelated code', () => {
    expect(isIndexAccessError('Found 3 errors.')).toBe(false);
    expect(isIndexAccessError(line('TS2304', "Cannot find name 'undefined_thing'."))).toBe(false);
  });
});
