/**
 * Scenario: the Maestro flows reach most screens by deep link rather than by
 * tapping through, so a screen that is deleted or renamed leaves the flow
 * opening a route that no longer exists. Maestro's `openLink` does not fail on
 * an unresolved route, it just leaves the app where it was, and the assertion
 * that follows then fails somewhere unrelated.
 *
 * Expected behaviour: every `openLink` in `.maestro` resolves to a file under
 * `src/app`, by the same rules expo-router uses.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../..');
const FLOWS_DIR = path.join(REPO_ROOT, '.maestro');
const APP_DIR = path.join(REPO_ROOT, 'src/app');

function flowFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return flowFiles(full);
    return entry.name.endsWith('.yaml') ? [full] : [];
  });
}

function openedLinks(): { flow: string; link: string }[] {
  return flowFiles(FLOWS_DIR).flatMap((file) => {
    const flow = path.relative(REPO_ROOT, file);
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => /^\s*-?\s*openLink:/.test(line))
      .map((line) => line.replace(/^\s*-?\s*openLink:\s*/, '').trim())
      .map((raw) => raw.replace(/^["']|["']$/g, ''))
      .filter((link) => link.startsWith('veloq://'))
      .map((link) => ({ flow, link }));
  });
}

/** The route files expo-router would try for a path, in the order it tries them. */
function candidates(routePath: string): string[] {
  if (routePath === '') return ['index.tsx', '(tabs)/index.tsx'];
  const segments = routePath.split('/');
  const group = ['', '(tabs)/'];
  const shapes = [`${routePath}.tsx`, `${routePath}/index.tsx`];
  if (segments.length > 1) {
    const parent = segments.slice(0, -1).join('/');
    shapes.push(`${parent}/[id].tsx`, `${parent}/[...rest].tsx`);
  }
  return group.flatMap((prefix) => shapes.map((shape) => `${prefix}${shape}`));
}

describe('maestro deep links', () => {
  const links = openedLinks();

  it('finds the flows and the links they open', () => {
    expect(links.length).toBeGreaterThan(10);
  });

  it.each(links)('$flow opens $link, which resolves to a route', ({ link }) => {
    const routePath = link.replace('veloq://', '').replace(/\?.*$/, '').replace(/\/$/, '');
    const resolved = candidates(routePath).filter((candidate) =>
      fs.existsSync(path.join(APP_DIR, candidate))
    );
    expect(resolved.length).toBeGreaterThan(0);
  });
});
