import deCH from '../../i18n/locales/de-CH.json';
import deDE from '../../i18n/locales/de-DE.json';

describe('de-CH table tennis label', () => {
  it('does not use the Swiss German word for table football', () => {
    expect(deCH.activityTypes.TableTennis).not.toMatch(/töggel/i);
  });

  it('keeps the single-word label in standard German', () => {
    expect(deCH.activityTypes.TableTennis).toBe(deDE.activityTypes.TableTennis);
  });
});
