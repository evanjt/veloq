/**
 * Scenario: `<Trans>` parses the tags inside a translated string and puts each one's text into
 * the element given for it, and that parser comes with react-i18next rather than with the app.
 *
 * Expected behaviour: the strength body type line renders its full sentence with the body type
 * inside the highlight, from every locale's string.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { createInstance } from 'i18next';
import { I18nextProvider, Trans, initReactI18next } from 'react-i18next';

import { loadableLocales } from '@/i18n/localeBundles';

import { resolvedLocale } from './resolvedLocale';

async function translatorFor(locale: string) {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: locale,
    resources: { [locale]: { translation: resolvedLocale(locale) } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

function plain(template: string, values: Record<string, string> = {}): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '')
    .replace(/<\/?\w+>/g, '');
}

function tagged(template: string, tag: string, values: Record<string, string> = {}): string {
  const match = template.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  if (!match) throw new Error(`no <${tag}> in "${template}"`);
  return plain(match[1], values);
}

describe('Trans with component tags', () => {
  it.each(loadableLocales())('%s puts the body type inside the highlight', async (locale) => {
    const i18n = await translatorFor(locale);
    const values = { bodyType: 'Sample' };

    for (const key of ['bodyTypeFromProfile', 'bodyTypeDefault'] as const) {
      const template = resolvedLocale(locale).strength[key] as string;
      const { getByTestId, unmount } = await render(
        <I18nextProvider i18n={i18n}>
          <Text testID="line">
            <Trans
              i18nKey={`strength.${key}`}
              values={values}
              components={{ type: <Text testID="highlight">{''}</Text> }}
            />
          </Text>
        </I18nextProvider>
      );

      expect(getByTestId('line')).toHaveTextContent(plain(template, values));
      expect(getByTestId('highlight')).toHaveTextContent(tagged(template, 'type', values));
      await unmount();
    }
  });
});
