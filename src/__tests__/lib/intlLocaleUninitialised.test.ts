/**
 * Scenario: a date is formatted before the app language is set up.
 *
 * Expected behaviour: the locale is the app's root locale, never undefined, so Intl cannot fall
 * through to the host's locale and spell the same date differently from one machine to the next.
 */

import { getIntlLocale } from '@/shared/format/locale';
import { formatFullDate } from '@/shared/format/format';
import { i18n } from '@/i18n';

describe('the Intl locale before i18n is initialised', () => {
  it('is the root locale, not undefined', () => {
    expect(i18n.language).toBeUndefined();
    expect(getIntlLocale()).toBe('en-GB');
  });

  it('spells a full date the same whatever the host locale is', () => {
    expect(formatFullDate(new Date(2024, 0, 15))).toBe('15 Jan 2024');
  });
});
