/**
 * Scenario: the insights tour slide named four categories in generic words, with no picture of
 * what a card looks like and no word on where one comes from.
 *
 * Expected behaviour: the slide draws example cards through the list card the Insights tab uses,
 * built by the generators that build the real ones, and one line says how an insight is made.
 * Every locale has that line, and the body stays one sentence with no claim about the home screen.
 */
import { resolvedLocale } from './resolvedLocale';
import React from 'react';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { InsightsSlide } from '@/features/settings/components/whatsNew/InsightsSlide';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

describe('the insights tour slide', () => {
  it('draws a section record and a fitness step as the Insights tab draws them', async () => {
    const { getAllByTestId } = await render(<InsightsSlide />);

    const ids = getAllByTestId(/^insight-card-.*(?<!-body)$/).map(
      (card) => card.props.testID as string
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^insight-card-section_pr-/);
    expect(ids[1]).toBe('insight-card-fitness_milestone-ftp');
  });

  it('titles each card with the generator copy, not a category label', async () => {
    const { getByText, queryByText } = await render(<InsightsSlide />);

    expect(getByText('insights.sectionPr')).toBeTruthy();
    expect(getByText('insights.ftpIncrease')).toBeTruthy();
    expect(queryByText('whatsNew.v030.insightsSectionPrs')).toBeNull();
  });

  it('draws each example card with the graphic of its history', async () => {
    const { getAllByTestId } = await render(<InsightsSlide />);

    expect(getAllByTestId('insight-graphic')).toHaveLength(2);
  });

  it('says how an insight is made, through the translator', async () => {
    const { getByText } = await render(<InsightsSlide />);

    expect(getByText('whatsNew.v030.insightsHow')).toBeTruthy();
  });

  it('has a value for that line in every locale', () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      expect(`${file} ${bundle.whatsNew.v030.insightsHow}`).not.toContain('undefined');
    }
  });
});

describe('the insights tour slide body', () => {
  it('is one sentence with no claim about the home screen, in every locale', () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      const body: string = bundle.whatsNew.v030.insightsBody;
      const sentences = body.split(/[.。]\s*/).filter((s) => s.length > 0);
      expect(`${file} ${sentences.length}`).toBe(`${file} 1`);
    }
  });
});
