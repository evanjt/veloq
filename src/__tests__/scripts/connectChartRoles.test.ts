/**
 * Scenario: a chart colour is read from the token role it stands for. A form band drawn in
 * the zone palette, a record in a diverging step or resting heart rate in the reverse-direction
 * rust each tell the athlete something the data does not say.
 *
 * Expected behaviour: each reader resolves, in both schemes, to the colour its role owns, and
 * the role guard refuses a token family read from a file not allowed to read it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';

import { FORM_ZONE_COLORS, FORM_ZONE_COLORS_DARK } from '@/features/fitness/lib/fitness';
import { colourTokens } from '@/theme/colourTokens.generated';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';
import {
  ACHIEVEMENT_COLOUR,
  directionColour,
  formZoneColour,
  wellnessColour,
  zoneColour,
} from '../../../web/connect/charts/colours';

const CSS = fs.readFileSync(
  path.join(__dirname, '../../../web/connect/tokens.generated.css'),
  'utf8'
);

/** The value a custom property takes in a scheme: the dark block overrides the light root. */
function resolve(reference: string, scheme: 'light' | 'dark'): string {
  const name = /^var\((--[\w-]+)\)$/.exec(reference)?.[1];
  if (!name) throw new Error(`not a custom property reference: ${reference}`);
  const blocks = CSS.split(':root[data-theme="dark"]');
  const read = (text: string) => new RegExp(`${name}: ([^;]+);`).exec(text)?.[1];
  const value =
    (scheme === 'dark' ? read(blocks[1]?.split('@media')[0] ?? '') : undefined) ??
    read(blocks[0] ?? '');
  if (!value) throw new Error(`${name} is not declared`);
  return value.toUpperCase();
}

describe('chart colour readers', () => {
  it.each(Object.keys(FORM_ZONE_COLORS) as (keyof typeof FORM_ZONE_COLORS)[])(
    'the %s form band equals the form palette in both schemes',
    (zone) => {
      expect(resolve(formZoneColour(zone), 'light')).toBe(FORM_ZONE_COLORS[zone].toUpperCase());
      expect(resolve(formZoneColour(zone), 'dark')).toBe(FORM_ZONE_COLORS_DARK[zone].toUpperCase());
    }
  );

  it.each(['light', 'dark'] as const)('records read the achievement token in %s', (scheme) => {
    expect(resolve(ACHIEVEMENT_COLOUR, scheme)).toBe(
      colourTokens[scheme].achievement.toUpperCase()
    );
  });

  it.each(['light', 'dark'] as const)(
    'the direction pair is the direction tokens in %s',
    (scheme) => {
      expect(resolve(directionColour('forward'), scheme)).toBe(
        colourTokens[scheme]['direction-forward'].toUpperCase()
      );
      expect(resolve(directionColour('reverse'), scheme)).toBe(
        colourTokens[scheme]['direction-reverse'].toUpperCase()
      );
    }
  );

  it.each(['light', 'dark'] as const)(
    'HRV and resting heart rate have their own tokens in %s',
    (scheme) => {
      const hrv = resolve(wellnessColour('hrv'), scheme);
      const rhr = resolve(wellnessColour('restingHr'), scheme);
      expect(hrv).not.toBe(rhr);
      expect(rhr).not.toBe(resolve(directionColour('reverse'), scheme));
    }
  );

  it('zone colours are the zone tokens', () => {
    expect(resolve(zoneColour(3), 'light')).toBe(colourTokens.light['zone-3'].toUpperCase());
  });
});

describe('the chart colour role guard', () => {
  const SCRIPT = path.join(__dirname, '../../../scripts/lint-chart-colour-roles.mjs');
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function runGuard(file: string, text: string): { status: number; output: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'chart-roles-'));
    roots.push(root);
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
    initFixtureRepo(root);
    try {
      const output = execFileSync('node', [SCRIPT, '--root', root], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gitFreeEnv(),
      });
      return { status: 0, output };
    } catch (error) {
      const e = error as { status: number; stdout?: string; stderr?: string };
      return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('refuses a gold read outside the records', () => {
    const { status, output } = runGuard(
      'web/connect/pages/FitnessPane.tsx',
      "colour: 'var(--colour-achievement)'"
    );
    expect(status).toBe(1);
    expect(output).toContain('FitnessPane.tsx:1 --colour-achievement');
  });

  it('allows the records to read gold', () => {
    expect(
      runGuard('web/connect/pages/RouteDetail.tsx', "colour: 'var(--colour-achievement)'").status
    ).toBe(0);
  });

  it('refuses the direction pair outside the section views', () => {
    expect(
      runGuard('web/connect/pages/Feed.tsx', 'stroke: var(--colour-direction-reverse)').status
    ).toBe(1);
  });

  it('refuses the retired chart and line aliases anywhere', () => {
    expect(runGuard('web/connect/pages/feed.css', 'stroke: var(--line-0);').status).toBe(1);
    expect(runGuard('web/connect/pages/x.tsx', "'var(--chart-b)'").status).toBe(1);
  });
});
