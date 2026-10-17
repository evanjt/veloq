/**
 * Scenario: the language list marks two variants (CH, AU) as dialects with an outline and
 * explains that outline with a key.
 * Expected behaviour: the key sits below the last language row rather than inside a row, so it
 * never reads as a label on the first language, and each dialect chip says it is a dialect in
 * its own accessibility label. The login picker and the Display settings draw the same list.
 */

import React from 'react';
import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { LanguagePicker } from '@/features/auth/components/LanguagePicker';
import { DisplaySettings } from '@/features/settings/components/DisplaySettings';
import { getAvailableLanguages } from '@/shared/app/LanguageStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

const languages = getAvailableLanguages().flatMap((g) => g.languages);
const firstLabel = languages[0].label;
const lastLabel = languages[languages.length - 1].label;

/** Every rendered string, in tree order. */
function textsInOrder(screen: RenderResult): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const children = (node as { children?: unknown }).children;
    if (children) walk(children);
  };
  walk(screen.toJSON());
  return out;
}

function expectKeyBelowList(screen: RenderResult) {
  const texts = textsInOrder(screen);
  const keyAt = texts.lastIndexOf('settings.dialect');
  expect(keyAt).toBeGreaterThan(-1);
  expect(keyAt).toBeGreaterThan(texts.indexOf(lastLabel));
  expect(texts.slice(0, texts.indexOf(firstLabel))).not.toContain('settings.dialect');
  expect(texts.slice(texts.indexOf(firstLabel), keyAt)).not.toContain('settings.dialect');
}

function expectDialectChipsSaySo(screen: RenderResult) {
  expect(screen.getByLabelText('CH, settings.dialect')).toBeTruthy();
  expect(screen.getByLabelText('AU, settings.dialect')).toBeTruthy();
  expect(screen.getByLabelText('DE')).toBeTruthy();
  expect(screen.getByLabelText('GB')).toBeTruthy();
}

describe('language list dialect key', () => {
  it('puts the key under the login picker list, not beside its first language', async () => {
    const screen = await render(<LanguagePicker />);
    await fireEvent.press(screen.getByTestId('login-language-button'));
    expectKeyBelowList(screen);
    expectDialectChipsSaySo(screen);
  });

  it.each(['en-GB', 'en-AU'])(
    'puts the key under the Display settings list with %s chosen',
    async (language) => {
      const screen = await render(
        <DisplaySettings
          themePreference="system"
          onThemeChange={jest.fn()}
          unitPreference="metric"
          onUnitChange={jest.fn()}
          intervalsUnitPreference={null}
          primarySport="Running"
          onSportChange={jest.fn()}
          language={language}
          onLanguageChange={jest.fn()}
        />
      );
      expectKeyBelowList(screen);
      expectDialectChipsSaySo(screen);
    }
  );
});
