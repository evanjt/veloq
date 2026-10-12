/**
 * Scenario: the tour's fitness slide is the athlete's first look at the Fitness tab.
 *
 * Expected behaviour: it shows four small cut-outs of that tab, fitness and fatigue, form, the
 * power curve and the power zones, under the titles the tab itself uses, drawn from one demo
 * training block that obeys the model the slide explains, with the tab's own lines saying what
 * fitness, fatigue and form are.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@testing-library/react-native';

import { formFromLoads } from '@/shared/math';
import { FitnessHeroSlide } from '@/features/settings/components/whatsNew/FitnessHeroSlide';
import {
  tourPowerCurve,
  tourTrainingBlock,
  tourZoneShares,
} from '@/features/settings/components/whatsNew/fitnessTourPreview';

import { resolvedLocale } from '../../i18n/resolvedLocale';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/ThemeProvider', () => ({ useResolvedColorScheme: () => 'light' }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

const LOCALES_DIR = path.join(__dirname, '../../../i18n/locales');

const CUTOUTS = [
  ['fitness-tour-fitness', 'fitnessScreen.fitnessAndFatigue'],
  ['fitness-tour-form', 'metrics.form'],
  ['fitness-tour-power-curve', 'stats.powerCurve'],
  ['fitness-tour-zones', 'stats.powerZones'],
] as const;

const EXPLANATIONS = [
  'fitnessScreen.fitnessDescription',
  'fitnessScreen.fatigueDescription',
  'fitnessScreen.formDescription',
];

function drawnKeys(tree: Awaited<ReturnType<typeof render>>): string[] {
  return tree.root.findAllByType('Text' as never).flatMap((node) => {
    const child = (node.props as { children?: unknown }).children;
    const parts = Array.isArray(child) ? child : [child];
    return parts.filter((part): part is string => typeof part === 'string' && part.includes('.'));
  });
}

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }, bundle);
}

describe('the tour fitness slide', () => {
  it('shows the four cut-outs of the Fitness tab under the titles the tab uses', async () => {
    const tree = await render(<FitnessHeroSlide />);

    for (const [testID, titleKey] of CUTOUTS) {
      const card = tree.getByTestId(testID);
      expect(drawnKeys({ ...tree, root: card } as never)).toContain(titleKey);
    }
  });

  it('says what fitness, fatigue and form are, in the words the Fitness tab uses', async () => {
    const drawn = drawnKeys(await render(<FitnessHeroSlide />));

    for (const key of EXPLANATIONS) expect(drawn).toContain(key);
  });

  it('draws only keys that have a value in every locale', async () => {
    const keys = drawnKeys(await render(<FitnessHeroSlide />));
    expect(keys.length).toBeGreaterThan(0);

    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      for (const key of keys)
        expect(`${file} ${key} ${typeof lookup(bundle, key)}`).toBe(`${file} ${key} string`);
    }
  });
});

describe('the tour demo training block', () => {
  const block = tourTrainingBlock();

  it('gives form as fitness minus fatigue on every day', () => {
    expect(block.length).toBeGreaterThan(0);
    for (const day of block) expect(day.form).toBe(formFromLoads(day.fitness, day.fatigue));
  });

  it('moves fitness slowly and fatigue quickly, as a 42 and a 7 day average do', () => {
    const steps = (pick: (d: (typeof block)[number]) => number) =>
      block.slice(1).map((day, i) => Math.abs(pick(day) - pick(block[i])));

    const fitnessStep = Math.max(...steps((d) => d.fitness));
    expect(fitnessStep).toBeGreaterThan(0);
    expect(Math.max(...steps((d) => d.fatigue))).toBeGreaterThan(fitnessStep * 3);
  });

  it('ends fresher than it was mid-block, the shape of a taper', () => {
    const middle = block[Math.floor(block.length / 2)];
    expect(block[block.length - 1].form).toBeGreaterThan(middle.form);
  });

  it('holds a power curve that never rises with duration', () => {
    const curve = tourPowerCurve();
    expect(curve.length).toBeGreaterThan(3);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].x).toBeGreaterThan(curve[i - 1].x);
      expect(curve[i].y).toBeLessThan(curve[i - 1].y);
    }
  });

  it('shares the zone time out to the whole', () => {
    const shares = tourZoneShares();
    expect(shares.map((s) => s.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });
});
