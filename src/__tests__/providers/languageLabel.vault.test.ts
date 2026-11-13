import { languageLabel } from '@/shared/app/LanguageStore';

describe('languageLabel', () => {
  it('names a variant with its base language', () => {
    expect(languageLabel('en-AU')).toEqual({ label: 'English (AU)', isDialect: true });
    expect(languageLabel('de-CH')).toEqual({ label: 'Deutsch (CH)', isDialect: true });
    expect(languageLabel('en-GB')).toEqual({ label: 'English (GB)', isDialect: false });
  });

  it('names a language with no variants by its own label', () => {
    expect(languageLabel('fr')).toEqual({ label: 'Français', isDialect: false });
  });

  it('falls back to the base language for a legacy code matched by prefix', () => {
    expect(languageLabel('fr-FR')).toEqual({ label: 'Français', isDialect: false });
    expect(languageLabel('en-NZ')).toEqual({ label: 'English', isDialect: false });
  });

  it('falls back to English for an unknown or missing code', () => {
    expect(languageLabel('xx')).toEqual({ label: 'English', isDialect: false });
    expect(languageLabel(null)).toEqual({ label: 'English', isDialect: false });
  });
});
