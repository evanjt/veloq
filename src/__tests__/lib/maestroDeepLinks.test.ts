/**
 * Scenario: the Maestro flows reach most screens by deep link rather than by
 * tapping through, so a screen that is deleted or renamed leaves the flow
 * opening a route that no longer exists. Maestro's `openLink` does not fail on
 * an unresolved route, it just leaves the app where it was, and the assertion
 * that follows then fails somewhere unrelated.
 *
 * Expected behaviour: every link a flow opens resolves to a file under
 * `src/app`, by the same rules expo-router uses. Flows open links through
 * `helpers/open-link.yaml`, so the link is the `LINK` env a flow passes it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { routeFilesFor } from '../__shared__/appRoutes';

const REPO_ROOT = path.join(__dirname, '../../..');
const FLOWS_DIR = path.join(REPO_ROOT, '.maestro');

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
      .filter((line) => /^\s*(?:-\s*)?(?:openLink|LINK):/.test(line))
      .map((line) => line.replace(/^\s*(?:-\s*)?(?:openLink|LINK):\s*/, '').trim())
      .map((raw) => raw.replace(/^["']|["']$/g, ''))
      .filter((link) => link.startsWith('veloq://'))
      .map((link) => ({ flow, link }));
  });
}

describe('maestro deep links', () => {
  const links = openedLinks();

  it('finds the flows and the links they open', () => {
    expect(links.length).toBeGreaterThan(10);
  });

  it.each(links)('$flow opens $link, which resolves to a route', ({ link }) => {
    expect(routeFilesFor(link).length).toBeGreaterThan(0);
  });

  /**
   * Scenario: a renamed screen keeps its old path as a redirect for one
   * release, and a flow written against the old path keeps opening it. When the
   * redirect is deleted on schedule, that flow opens a route that matches
   * nothing and fails at the next assertion, which reads as a regression in
   * whatever the flow was checking.
   *
   * Expected behaviour: only the flow whose job is the redirect opens one.
   */
  it('opens a redirect only from the flow that checks redirects', () => {
    const redirects = (link: string) =>
      routeFilesFor(link).some((file) => {
        const source = fs.readFileSync(file, 'utf-8');
        return /\b(?:replaceTo|returnTo)\(|<Redirect\b/.test(source) && /return null;/.test(source);
      });

    const viaRedirect = links.filter(({ link }) => redirects(link)).map(({ flow }) => flow);

    expect(viaRedirect.length).toBeGreaterThan(0);
    expect([...new Set(viaRedirect)]).toEqual(['.maestro/navigation-deep-links.yaml']);
  });
});
