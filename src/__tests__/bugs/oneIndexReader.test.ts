/**
 * Scenario: two scripts carried their own copy of the same walk, a `git ls-files`
 * listing fed into one `git cat-file --batch` and a hand-written pass over the
 * `<sha> <type> <size>` headers. A gitlink's header carries no size, one copy
 * read it as a blob's and stopped there, and the other carried the same shape
 * plus a fallback to the working tree instead of a refusal.
 *
 * Expected behaviour: one walk, in `scripts/lib/indexedSources.mjs`, so a defect
 * in it is fixed once. A second copy is what this refuses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SCRIPTS = resolve('scripts');
const HELPER = join(SCRIPTS, 'lib', 'indexedSources.mjs');

/** Asking git for a file's bytes out of the index, however it is spelled. */
const READS_THE_INDEX = /cat-file['"]?\s*,\s*['"]--batch/;

function scriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(full);
    return /\.(mjs|ts)$/.test(entry.name) ? [full] : [];
  });
}

describe('the index reader', () => {
  it('is the only thing in scripts that walks a cat-file batch', () => {
    const copies = scriptFiles(SCRIPTS)
      .filter((file) => file !== HELPER)
      .filter((file) => READS_THE_INDEX.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SCRIPTS, file));

    expect(copies).toEqual([]);
  });

  it('is still something this guard can find, or it is testing nothing', () => {
    expect(READS_THE_INDEX.test(readFileSync(HELPER, 'utf8'))).toBe(true);
  });

  it('is what the area report reads through', () => {
    const report = readFileSync(join(SCRIPTS, 'ffi-usage-report.ts'), 'utf8');

    expect(report).toMatch(/from '\.\/lib\/indexedSources\.mjs'/);
  });

  it('refuses a short read rather than handing back what it managed', () => {
    const helper = readFileSync(HELPER, 'utf8');

    expect(helper).toMatch(/throw new Error/);
    expect(helper).toMatch(/read !== files\.length/);
  });
});
