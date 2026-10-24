/**
 * Scenario: the widgets shot and the privacy panel are composed from facts the
 * tree owns, not from text held beside the compositor.
 *
 * Expected behaviour: the widgets shot draws exactly the widget kinds each
 * platform ships, each privacy claim is held by a check against the tree, and
 * a claim whose check finds something is reported rather than printed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  PRIVACY_CLAIMS,
  SHOT_WIDGETS,
  WIDGET_PLACEMENTS,
  capturedScreenHtml,
  shotWidgetFile,
  privacyListHtml,
  shippedWidgets,
  widgetScreenHtml,
} from '../../../scripts/store-panels';

const ROOT = path.resolve(__dirname, '../../..');

describe('the widgets shot', () => {
  it.each(['android', 'ios'] as const)('draws the widgets %s ships and no others', (platform) => {
    expect(WIDGET_PLACEMENTS.map((p) => p.name).sort()).toEqual(shippedWidgets(ROOT, platform));
  });

  it('draws one image per placed widget, in order', () => {
    const files = WIDGET_PLACEMENTS.map((p) => `/raw/${p.name}.png`);
    const html = widgetScreenHtml(files);
    const drawn = [...html.matchAll(/src="file:\/\/([^"]+)"/g)].map((m) => m[1]);
    expect(drawn).toEqual(files);
  });

  it('does not count the record control as a widget', () => {
    expect(shippedWidgets(ROOT, 'ios')).toHaveLength(4);
  });
});

describe('the privacy panel', () => {
  it('holds every claim against the tree as it stands', () => {
    for (const claim of PRIVACY_CLAIMS)
      expect([claim.id, claim.check(ROOT)]).toEqual([claim.id, []]);
  });

  it('states exactly the four claims it checks', () => {
    expect(PRIVACY_CLAIMS.map((c) => c.id)).toEqual([
      'no-account',
      'no-analytics',
      'on-device',
      'open-source',
    ]);
    const html = privacyListHtml(PRIVACY_CLAIMS);
    for (const claim of PRIVACY_CLAIMS) expect(html).toContain(claim.text);
  });

  describe('against a tree that breaks the claims', () => {
    let root: string;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-'));
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ dependencies: { '@sentry/react-native': '1', react: '1' } })
      );
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src', 'a.ts'), "fetch('https://api.veloq.fit/account');");
      fs.mkdirSync(path.join(root, 'modules/veloqrs/rust/veloqrs'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'modules/veloqrs/rust/veloqrs/Cargo.toml'),
        '[dependencies]\n'
      );
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it.each(['no-account', 'no-analytics', 'on-device', 'open-source'])('fails %s', (id) => {
      const claim = PRIVACY_CLAIMS.find((c) => c.id === id);
      expect(claim?.check(root)).not.toEqual([]);
    });
  });
});

describe('the fitness and strength shots', () => {
  let raw: string;
  beforeAll(() => {
    raw = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-widgets-'));
    for (const platform of ['android', 'ios'] as const) {
      fs.mkdirSync(path.join(raw, platform, 'widgets'), { recursive: true });
      for (const p of WIDGET_PLACEMENTS) {
        fs.writeFileSync(path.join(raw, platform, 'widgets', p.file[platform]), '');
      }
    }
  });
  afterAll(() => fs.rmSync(raw, { recursive: true, force: true }));

  it.each([
    ['android', '06-fitness', 'summary-4x2'],
    ['android', '07-strength', 'strength-4x2'],
    ['ios', '06-fitness', 'summary-medium'],
    ['ios', '07-strength', 'strength-medium'],
  ] as const)('%s %s draws the %s widget capture over the screen', (platform, stem, drawn) => {
    const html = capturedScreenHtml(`/raw/${stem}.png`, shotWidgetFile(raw, platform, stem));
    const images = [...html.matchAll(/src="file:\/\/([^"]+)"/g)].map((m) => m[1]);
    expect(images).toHaveLength(2);
    expect(images[0]).toBe(`/raw/${stem}.png`);
    expect(images[1]).toContain(drawn);
  });

  it('draws no widget on a shot that carries none', () => {
    expect(shotWidgetFile(raw, 'android', '01-feed')).toBeUndefined();
    expect(capturedScreenHtml('/raw/01-feed.png')).not.toContain('shot-widget');
  });

  it('names a missing widget capture rather than composing without it', () => {
    expect(() => shotWidgetFile(path.join(raw, 'nowhere'), 'ios', '06-fitness')).toThrow(
      /Missing widget capture/
    );
  });

  it('carries a widget on exactly the fitness and strength shots', () => {
    expect(SHOT_WIDGETS).toEqual({ '06-fitness': 'summary', '07-strength': 'strength' });
  });
});
