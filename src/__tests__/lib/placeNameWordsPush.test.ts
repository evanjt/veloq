/**
 * Scenario: the engine names a new route or section after a sync, possibly in
 * a process where no JavaScript is running to translate anything.
 *
 * Expected behaviour: the words for the locale the app last ran in are already
 * stored, with their placeholders left for the engine to fill, and a bundle
 * that has not loaded yet is never the thing that gets stored.
 */

import { initialiseI18n, changeLanguage, i18n } from '@/i18n';
import { PLACE_NAME_WORDS_KEY, pushPlaceNameWords } from '@/i18n/placeNameWords';

const mockSetSetting = jest.fn((_key: string, _value: string) => Promise.resolve());

jest.mock('@/shared/storage/settingsStorage', () => ({
  setSetting: (key: string, value: string) => mockSetSetting(key, value),
}));

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

beforeEach(async () => {
  mockSetSetting.mockClear();
  await changeLanguage('en-AU');
});

function stored(): { locale: string; loop: string; journey: string } {
  expect(mockSetSetting).toHaveBeenCalledTimes(1);
  const [key, value] = mockSetSetting.mock.calls[0];
  expect(key).toBe(PLACE_NAME_WORDS_KEY);
  return JSON.parse(value);
}

describe('pushPlaceNameWords', () => {
  it('stores the words with their placeholders and the locale they are in', () => {
    pushPlaceNameWords();

    expect(stored()).toEqual({
      locale: 'en-AU',
      loop: '{{place}} Loop',
      journey: '{{start}} to {{end}}',
    });
  });

  it('stores the words of the language just chosen', async () => {
    await changeLanguage('de-DE');
    pushPlaceNameWords();

    expect(stored()).toEqual({
      locale: 'de-DE',
      loop: '{{place}} Runde',
      journey: '{{start}} nach {{end}}',
    });
  });

  it('keeps what was stored when the bundle resolves keys as themselves', () => {
    const t = jest.spyOn(i18n, 't').mockImplementation(((key: string) => key) as never);
    try {
      pushPlaceNameWords();
    } finally {
      t.mockRestore();
    }

    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});
