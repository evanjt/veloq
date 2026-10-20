/**
 * Scenario: a flow opens a screen by deep link, and the app's list of the
 * routes a link from outside may open does not carry it. The link then opens
 * nothing, the flow stays on the screen before, and the step after it fails on
 * an id that screen never draws.
 *
 * Expected behaviour: every `openLink` in a flow names a route the app opens.
 * The flows drive the development build, which opens the developer screens too.
 */
import fs from 'fs';
import path from 'path';

import { openableSystemPath } from '@/features/insights/lib/pushPayload';

const ROOT = path.join(__dirname, '../../..');

function flowFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return flowFiles(full);
    return entry.name.endsWith('.yaml') ? [full] : [];
  });
}

const links = [
  ...new Set(
    flowFiles(path.join(ROOT, '.maestro')).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/openLink:\s*"?(veloq:\/\/[^"\s]*)/g)].map(
        (match) => match[1]
      )
    )
  ),
].sort();

describe('every deep link a flow opens is one the app opens', () => {
  it('finds the links the flows open', () => {
    expect(links).toContain('veloq://display-settings');
  });

  it.each(links)('opens %s', (link) => {
    expect(openableSystemPath(link, null, true)).toBe(link);
  });
});
