/**
 * Scenario: an athlete's FTP setting has been 250 W all year, their eFTP was
 * 238 W on the record's day and is 252 W now. The stale PR card called both
 * "Cycling FTP", and the runner's card called a 42-day critical speed
 * "Running threshold pace". The group subtitle and the sheet's headings were
 * English literals, so German read 'FTP: 238W → 252W'.
 *
 * Expected behaviour: the card and its sheet name the number that moved, eFTP
 * or critical speed, in every string they draw, and in the athlete's language.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';
import type { StalePrOpportunity } from 'veloqrs';

import { changeLanguage, i18n, initializeI18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));

/** The app's own `t`, in whatever language the test switched to. */
const t = i18n.t.bind(i18n) as unknown as TFunc;

function opportunity(
  sectionId: string,
  over: Partial<Record<string, unknown>> = {}
): StalePrOpportunity {
  return {
    sectionId,
    sectionName: `Section ${sectionId}`,
    bestTimeSecs: 372,
    daysSinceLast: 40,
    traversalCount: 6,
    fitnessMetric: 'power',
    currentValue: 252,
    previousValue: 238,
    gainPercent: 6,
    unit: 'W',
    sportType: 'Ride',
    ...over,
  } as unknown as StalePrOpportunity;
}

const RUN = {
  fitnessMetric: 'pace',
  currentValue: 4.1,
  previousValue: 3.9,
  unit: '/km',
  sportType: 'Run',
};

function cardText(insight: Insight): string[] {
  const data = insight.supportingData;
  return [
    insight.title,
    insight.subtitle ?? '',
    insight.body ?? '',
    ...(data?.dataPoints ?? []).map((dp) => `${dp.label} ${dp.value}`),
    data?.formula ?? '',
    insight.methodology?.name ?? '',
  ];
}

function textOf(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  return (node.children ?? []).flatMap((child) => textOf(child as ReactTestRendererJSON | string));
}

function sheetText(insight: Insight): string[] {
  const { toJSON } = render(<StalePRContent insight={insight} />);
  return textOf(toJSON() as ReactTestRendererJSON | null);
}

/** FTP that is not the e of eFTP: the setting, which none of these values is. */
const BARE_FTP = /(^|[^e])FTP/;

describe('the stale PR card names eFTP and critical speed', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  afterEach(async () => {
    await changeLanguage('en-AU');
  });

  it.each(['en-AU', 'de-DE', 'fr', 'ja'] as const)(
    'names eFTP and never the setting on a single power card in %s',
    async (locale) => {
      await changeLanguage(locale);
      const [insight] = generateStalePRInsights([opportunity('a')], t, 0);
      const text = [...cardText(insight), ...sheetText(insight)];

      expect(text.join(' ')).toContain('eFTP');
      expect(text.filter((line) => BARE_FTP.test(line))).toEqual([]);
    }
  );

  it.each(['en-AU', 'de-DE', 'fr', 'ja'] as const)(
    'names eFTP and never the setting on a group power card in %s',
    async (locale) => {
      await changeLanguage(locale);
      const [group] = generateStalePRInsights([opportunity('a'), opportunity('b')], t, 0);
      const text = [...cardText(group), ...sheetText(group)];

      expect(group.subtitle).toContain('eFTP');
      expect(text.filter((line) => BARE_FTP.test(line))).toEqual([]);
    }
  );

  it('names critical speed, not a threshold, on a run card', () => {
    const [insight] = generateStalePRInsights([opportunity('r', RUN)], t, 0);
    const text = [...cardText(insight), ...sheetText(insight)].join(' ');

    expect(insight.supportingData?.formula).toContain('critical speed');
    expect(text).toContain('Running critical speed');
    expect(text.toLowerCase()).not.toContain('threshold');
  });

  it('names critical speed in a run group subtitle', () => {
    const [group] = generateStalePRInsights([opportunity('r', RUN), opportunity('s', RUN)], t, 0);

    expect(group.subtitle).toContain('Running critical speed');
    // A group carries no data rows, so the sheet names the metric from the
    // sport its sections share.
    expect(sheetText(group)).toContain('Current running critical speed vs PR period');
  });

  it('draws the sheet in German, not in English', async () => {
    const [single] = generateStalePRInsights([opportunity('a')], t, 0);
    const [group] = generateStalePRInsights([opportunity('a'), opportunity('b', RUN)], t, 0);
    const english = new Set([...sheetText(single), ...sheetText(group), group.subtitle]);

    await changeLanguage('de-DE');
    const [deSingle] = generateStalePRInsights([opportunity('a')], t, 0);
    const [deGroup] = generateStalePRInsights([opportunity('a'), opportunity('b', RUN)], t, 0);
    const german = [...sheetText(deSingle), ...sheetText(deGroup), deGroup.subtitle ?? ''];

    // The section names and the numbers are the same in both languages.
    const prose = german.filter((line) => /[a-z]{4,}/i.test(line) && !/^Section /.test(line));
    expect(prose.filter((line) => english.has(line))).toEqual([]);
  });
});
