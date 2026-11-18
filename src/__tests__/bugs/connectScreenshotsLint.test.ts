/**
 * Scenario: `connect-screenshots/` is git-ignored output that exists only in a
 * checkout which has run `npm run connect:screenshots`. The lint config did not
 * ignore it, so a worktree holding a screenshot script's output failed the
 * landing gate's zero-warning lint on that output.
 * Expected behaviour: a file under `connect-screenshots/` is not linted, while
 * a source file that looks like it is still linted.
 */

import { lintSource } from '../__shared__/lintSource';

const WARNING_SOURCE =
  'export const first = [1][0]!;\nexport function log(x: number) {\n  console.log(x);\n}\n';

describe('the connect screenshot output', () => {
  it('is not linted', async () => {
    expect(await lintSource(WARNING_SOURCE, 'connect-screenshots/survey.ts')).toBe('[]');
  });

  it('is not linted in a subdirectory', async () => {
    expect(await lintSource(WARNING_SOURCE, 'connect-screenshots/mockups/survey.ts')).toBe('[]');
  });

  it('is still linted when it is source under a similar name', async () => {
    const messages = await lintSource(WARNING_SOURCE, 'src/connectScreenshotsFixture.ts');
    expect(messages).toContain('no-console');
    expect(messages).toContain('no-non-null-assertion');
  });
});
