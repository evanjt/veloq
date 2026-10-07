/**
 * Scenario: the device locale is en-US and the app language is ja. A date
 * formatted with no locale, or with undefined, renders English month names.
 *
 * Expected behaviour: every athlete-facing date call passes the app locale.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');
const EXEMPT = ['app/debug.tsx', 'features/routes/components/SyncDebugTab.tsx'];
const DEVICE_LOCALE_CALL =
  /\b(?:toLocale(?:Date|Time)?String|Intl\.DateTimeFormat)\(\s*(?:\)|undefined\b|'en-US')/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('date formatting locale', () => {
  it('never formats an athlete-facing date with the device locale', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file);
      if (EXEMPT.includes(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(DEVICE_LOCALE_CALL)) {
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
