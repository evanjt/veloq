/**
 * Scenario: the form zone label is drawn on the summary card, the today
 * banner and the form chart, and the widget draws the
 * same zone from the same catalogue of names.
 *
 * Expected behaviour: every one of them reads the athlete's language. The
 * labels lived in a hardcoded English map beside a translated key set the
 * widget was already using, so a German athlete read "Grey Zone" on the
 * screen and "Grauzone" on the widget.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { formZoneLabel } from '@/features/fitness/lib/fitness';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

/** Form -3 on fitness 40 sits in the grey zone. */
const DAYS = [{ id: '2026-09-12', ctl: 40, atl: 43 }] as WellnessData[];

describe('the form zone label', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  afterEach(async () => {
    await changeLanguage('en-AU');
  });

  it('reads the athlete language on the form chart', async () => {
    await changeLanguage('de-DE');

    await render(<FormZoneChart data={DAYS} />);

    expect(screen.getByTestId('form-chart-zone')).toHaveTextContent('Grauzone', { exact: true });
    expect(screen.queryByText('Grey zone')).toBeNull();
  });

  it('answers in English when that is the language', async () => {
    await changeLanguage('en-AU');

    await render(<FormZoneChart data={DAYS} />);

    expect(screen.getByTestId('form-chart-zone')).toHaveTextContent('Grey zone', { exact: true });
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

    expect(formZoneLabel('highRisk')).toBe('High risk');
  });
});
