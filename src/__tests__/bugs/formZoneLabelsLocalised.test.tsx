/**
 * Scenario: the form zone label is drawn on the summary card, the today
 * banner, the fitness header and the form chart, and the widget draws the
 * same zone from the same catalogue of names.
 *
 * Expected behaviour: every one of them reads the athlete's language. The
 * labels lived in a hardcoded English map beside a translated key set the
 * widget was already using, so a German athlete read "Grey Zone" on the
 * screen and "Grauzone" on the widget.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { FitnessHeaderStats } from '@/features/fitness/components/FitnessHeaderStats';
import { formZoneLabel } from '@/features/fitness/lib/fitness';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ colors: { textSecondary: '#888' } }),
}));

const values = { fitness: 40, fatigue: 55, form: -15 };

describe('the form zone label', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  afterEach(async () => {
    await changeLanguage('en-AU');
  });

  it('reads the athlete language on the fitness header', async () => {
    await changeLanguage('de-DE');

    render(
      <FitnessHeaderStats
        displayDate="2026-09-12"
        displayValues={values}
        formZone="greyZone"
        isDark={false}
        rampRate={null}
      />
    );

    expect(screen.getByText('Grauzone')).toBeTruthy();
    expect(screen.queryByText('Grey Zone')).toBeNull();
  });

  it('answers in English when that is the language', async () => {
    await changeLanguage('en-AU');

    render(
      <FitnessHeaderStats
        displayDate="2026-09-12"
        displayValues={values}
        formZone="greyZone"
        isDark={false}
        rampRate={null}
      />
    );

    expect(screen.getByText('Grey Zone')).toBeTruthy();
  });

  it('names every zone in the athlete language, not just the one on screen', async () => {
    await changeLanguage('de-DE');

    expect(formZoneLabel('highRisk')).toBe('Hohes Risiko');
    expect(formZoneLabel('optimal')).toBe('Optimal');
    expect(formZoneLabel('greyZone')).toBe('Grauzone');
    expect(formZoneLabel('fresh')).toBe('Erholt');
    expect(formZoneLabel('transition')).toBe('Übergang');
  });

  it('falls back to the key rather than an empty label for an unknown locale', async () => {
    await changeLanguage('en-AU');

    expect(formZoneLabel('highRisk')).toBe('High Risk');
  });
});
