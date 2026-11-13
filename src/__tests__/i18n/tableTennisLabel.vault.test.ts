import deCH from '../../i18n/locales/de-CH.json';

describe('de-CH table tennis label', () => {
  it('does not use the Swiss German word for table football', () => {
    expect(deCH.activityTypes.TableTennis).not.toMatch(/töggel/i);
  });
});
