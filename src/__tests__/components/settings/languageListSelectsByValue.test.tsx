/**
 * Scenario: an automated run picks the app's language by its code, because a
 * row's label is the language's own name and a regional chip's label is two
 * letters that repeat across languages ("PT" is a chip under Português).
 * Expected behaviour: every language the list offers has one control keyed
 * `language-<code>`, and pressing it selects exactly that code, never the
 * language's default variant.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { getAvailableLanguages } from '@/shared/app/LanguageStore';
import { LanguageList } from '@/shared/ui/LanguageList';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

const offered = getAvailableLanguages()
  .flatMap((group) => group.languages)
  .flatMap((lang) => (lang.variants ? lang.variants.map((v) => v.value) : [lang.value]));

describe('LanguageList', () => {
  it.each(offered)('selects %s from the control keyed by its code', (code) => {
    const onSelect = jest.fn();
    const screen = render(<LanguageList language="en-GB" onSelect={onSelect} />);
    fireEvent.press(screen.getByTestId(`language-${code}`));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(code);
  });

  it('keeps Portuguese (Portugal) apart from the Portuguese row, which selects Brazil', () => {
    const onSelect = jest.fn();
    const screen = render(<LanguageList language="en-GB" onSelect={onSelect} />);
    expect(screen.getAllByTestId('language-pt')).toHaveLength(1);
    fireEvent.press(screen.getByTestId('language-pt'));
    expect(onSelect).toHaveBeenCalledWith('pt');
  });
});
