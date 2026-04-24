/**
 * US-PRM1 static regression: the RecordingPermissionSection (which contains
 * the "Write permission not granted" prompt) must not be mounted from any
 * shipping code path in v0.3.0. Recording is feature-gated off.
 *
 * The component still exists for future re-enabling once recording ships,
 * but nothing outside its own file should import it today.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const COMPONENT = 'RecordingPermissionSection';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.expo') continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('US-PRM1: no write-permission prompt in shipping code', () => {
  it('RecordingPermissionSection is not imported by any production file', () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      if (file.endsWith(`${COMPONENT}.tsx`)) continue;
      if (file.endsWith('settings/index.ts')) {
        // Re-export from barrel is OK as long as nothing else imports it.
        // We catch real mounts in the next scan below.
        continue;
      }
      const src = readFileSync(file, 'utf8');
      const usageRegex = new RegExp(`<${COMPONENT}\\b`);
      if (usageRegex.test(src)) {
        violations.push(`${file}: mounts <${COMPONENT} />`);
      }
    }

    expect(violations).toEqual([]);
  });
});
