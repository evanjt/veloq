/**
 * Scenario: the insights tour slide names four categories. They were English literals, so under
 * another app language the slide title came through translated and the rows beneath did not.
 *
 * Expected behaviour: every row label is a translation key, and every locale has a value for it.
 */
import { resolvedLocale } from './resolvedLocale';
import React from 'react';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { InsightsSlide } from '@/features/settings/components/whatsNew/InsightsSlide';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const KEYS = [
  'insightsSectionPrs',
  'insightsEfficiency',
  'insightsMilestones',
  'insightsHrv',
] as const;

describe('the insights tour slide', () => {
  it('renders each category through the translator', () => {
    const { getByText } = render(<InsightsSlide />);

    for (const key of KEYS) expect(getByText(`whatsNew.v030.${key}`)).toBeTruthy();
  });

  it('has a value for every category in every locale', () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      for (const key of KEYS) {
        expect(`${file} ${bundle.whatsNew.v030[key]}`).not.toContain('undefined');
      }
    }
  });
});

describe('the insights tour slide body', () => {
  it('describes the categories only, with no claim about the home screen, in every locale', () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      const body: string = bundle.whatsNew.v030.insightsBody;
      const sentences = body.split(/[.。]\s*/).filter((s) => s.length > 0);
      expect(`${file} ${sentences.length}`).toBe(`${file} 1`);
    }
  });
});
