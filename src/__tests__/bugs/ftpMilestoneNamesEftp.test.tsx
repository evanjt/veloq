/**
 * Scenario: the FTP milestone reads `sportInfo[].eftp` from the stored wellness
 * body, intervals.icu's estimate from the power curve, and compared it against
 * the value 30 days earlier. Its copy called all of that "your FTP setting".
 *
 * Expected behaviour: an athlete whose setting has been 250 W all year, and
 * whose eFTP moved, is told which number moved and what it was compared with.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import type { Insight, TFunc } from '@/features/insights/types';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { MethodologySection } from '@/features/insights/components/MethodologySection';

import { InsightListCard } from '@/features/insights/components/InsightListCard';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

/**
 * Scenario: the card that opens the sheet reads 'Cycling eFTP: 252W (+12W)',
 * and the sheet's context card under it read 'FTP change context' and 'FTP
 * shifted from 240W to 252W', in English whatever the app's language. The pace
 * milestone called a 42-day critical speed a threshold pace and stated
 * neither the window nor the 90-day lookback.
 *
 * Expected behaviour: the sheet names the number that moved and what it was
 * compared with, in the athlete's language, and the pace method states the
 * curve and the lookback it reads.
 */
describe('the fitness milestone sheet', () => {
  /** The app's own `t`, in whatever language the test switched to. */
  const t = i18n.t.bind(i18n) as unknown as TFunc;
  const NOW = Date.UTC(2026, 8, 20);
  const DAY = 86_400;

  const POWER = {
    latestFtp: 252,
    previousFtp: 240,
    deltaWatts: 12,
    latestDate: NOW / 1000,
    previousDate: NOW / 1000 - 30 * DAY,
    sampleCount: 31,
  };
  const PACE = {
    latestPace: 4.2,
    previousPace: 4.0,
    gainPercent: 5,
    deltaSeconds: 12,
    latestDate: NOW / 1000,
    previousDate: NOW / 1000 - 20 * DAY,
    sampleCount: 6,
  };

  function textOf(node: unknown): string[] {
    if (node == null) return [];
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(textOf);
    const { children } = node as { children?: unknown[] };
    return (children ?? []).flatMap(textOf);
  }

  async function rendered(element: React.ReactElement): Promise<string> {
    return textOf((await render(element)).toJSON()).join(' ');
  }

  /** The method as it reads once "How was this calculated?" is open. */
  async function method(insight: Insight): Promise<string> {
    const view = await render(<MethodologySection insight={insight} />);
    await fireEvent.press(view.getByTestId('methodology-toggle'));
    return `${insight.methodology?.name} ${textOf(view.toJSON()).join(' ')}`;
  }

  function milestones() {
    return generateFitnessMilestoneInsights(POWER, PACE, null, NOW, t);
  }

  function sheet(id: string): Promise<string> {
    const insight = milestones().find((i) => i.id === id);
    if (!insight) throw new Error(`no ${id} milestone`);
    return rendered(<FitnessMilestoneContent insight={insight} />);
  }

  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  afterEach(async () => {
    await changeLanguage('en-AU');
  });

  it('names eFTP on the power sheet and never the setting', async () => {
    const text = await sheet('fitness_milestone-ftp');

    expect(text).toContain('eFTP');
    expect(text).not.toContain('FTP shifted');
    expect(text).not.toMatch(/(^|[^e])FTP/);
  });

  it('names eFTP on the power card and states the 30-day comparison in its method', async () => {
    const power = milestones().find((i) => i.id === 'fitness_milestone-ftp');
    if (!power) throw new Error('no power milestone');
    const card = await rendered(<InsightListCard insight={power} onPress={jest.fn()} />);
    const methodText = await method(power);

    expect(card).toContain('eFTP');
    expect(card).not.toMatch(/(^|[^e])FTP/);
    expect(methodText).toContain('eFTP');
    expect(methodText).not.toMatch(/(^|[^e])FTP (?!setting)/);
    expect(methodText).toContain('30 days');
  });

  it('names critical speed on the pace sheet, not a threshold pace', async () => {
    const text = await sheet('fitness_milestone-pace');

    expect(text).toContain('critical speed');
    expect(text.toLowerCase()).not.toContain('threshold');
  });

  it('draws no English on the sheet in German', async () => {
    const ids = ['fitness_milestone-ftp', 'fitness_milestone-pace'];
    const sheetLines = async () => {
      const lines: string[] = [];
      for (const id of ids) lines.push(...(await sheet(id)).split(/(?<=\.) /));
      return lines;
    };
    const english = new Set(await sheetLines());

    await changeLanguage('de-DE');
    const german = await sheetLines();

    const prose = german.filter((line) => /[a-z]{4,}/i.test(line));
    expect(prose.filter((line) => english.has(line))).toEqual([]);
    expect(german.join(' ')).toContain('eFTP');
  });

  it('states the critical speed, the 42-day curve and the 90-day lookback in the pace method', async () => {
    const pace = milestones().find((i) => i.id === 'fitness_milestone-pace');
    if (!pace) throw new Error('no pace milestone');
    const methodText = await method(pace);

    expect(methodText.toLowerCase()).toContain('critical speed');
    expect(methodText).toContain('42-day');
    expect(methodText).toContain('90 days');
    expect(methodText.toLowerCase()).not.toContain('threshold');
  });
});
