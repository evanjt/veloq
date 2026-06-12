/**
 * Static guards for the Maestro flow suite.
 *
 * Scenario: flow tags drive CI selection (tier gates, pack pipelines), and
 * deep links into demo activities silently exercise the error screen when the
 * ID doesn't exist in the fixtures.
 * Expected behaviour: every flow carries exactly one tier tag; tier0-3 flows
 * carry exactly one known pack tag; tier4/5 flows carry none; and every
 * demo-prefixed deep link resolves to a real fixture activity ID.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fixtures } from '@/data/demo/fixtures';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');

const KNOWN_PACKS = new Set([
  'pack-auth',
  'pack-nav',
  'pack-home',
  'pack-activity',
  'pack-map',
  'pack-fitness',
  'pack-training',
  'pack-routes',
  'pack-settings',
  'pack-data',
  'pack-stress',
]);

const flowFiles = fs
  .readdirSync(MAESTRO_DIR)
  .filter((f) => f.endsWith('.yaml') && f !== 'config.yaml')
  .sort();

function readFlow(file: string): string {
  return fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8');
}

function header(content: string): string {
  const idx = content.indexOf('\n---');
  return idx === -1 ? content : content.slice(0, idx);
}

function tierTags(content: string): string[] {
  return [...header(content).matchAll(/^\s*-\s*(tier\d)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

function packTags(content: string): string[] {
  return [...header(content).matchAll(/^\s*-\s*(pack-[a-z]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

describe('maestro flow tags', () => {
  it('finds the flow suite', () => {
    expect(flowFiles.length).toBeGreaterThan(90);
  });

  it.each(flowFiles)('%s has exactly one tier tag', (file) => {
    expect(tierTags(readFlow(file))).toHaveLength(1);
  });

  it.each(flowFiles)('%s pack tagging matches its tier', (file) => {
    const content = readFlow(file);
    const tier = tierTags(content)[0];
    const packs = packTags(content);
    if (tier === 'tier4' || tier === 'tier5') {
      expect(packs).toHaveLength(0);
    } else {
      expect(packs).toHaveLength(1);
      expect(KNOWN_PACKS.has(packs[0])).toBe(true);
    }
  });
});

describe('maestro demo deep links', () => {
  const validIds = new Set(fixtures.activities.map((a) => a.id));

  it.each(flowFiles)('%s demo deep links resolve to fixture activities', (file) => {
    const content = readFlow(file);
    const linked = [...content.matchAll(/veloq:\/\/activity\/([\w-]+)/g)].map((m) => m[1]);
    // Non-demo IDs (e.g. "this-does-not-exist") are intentional error-state
    // probes; demo-prefixed IDs must exist or the flow tests the wrong screen.
    const demoLinks = linked.filter((id) => id.startsWith('demo-'));
    const unknown = demoLinks.filter((id) => !validIds.has(id));
    expect(unknown).toEqual([]);
  });
});
