import { isSheetPath, screenPathUnder } from '@/shared/app/screenUnderSheet';

describe('the screen under a sheet', () => {
  it('is the pathname itself away from any sheet', () => {
    expect(screenPathUnder('/map', '/fitness')).toBe('/map');
    expect(screenPathUnder('/', null)).toBe('/');
  });

  it('is the last screen while a sheet, or a sheet over a sheet, is presented', () => {
    expect(screenPathUnder('/sheets/section-chooser', '/map')).toBe('/map');
    expect(screenPathUnder('/sheets/merge-confirm', '/route/r1')).toBe('/route/r1');
  });

  it("is the sheet's own path when nothing was seen under it", () => {
    expect(screenPathUnder('/sheets/explainer', null)).toBe('/sheets/explainer');
  });

  it('tells a sheet from a screen whose name only begins the same', () => {
    expect(isSheetPath('/sheets/insight')).toBe(true);
    expect(isSheetPath('/sheets')).toBe(false);
    expect(isSheetPath('/sheetsettings')).toBe(false);
    expect(isSheetPath('/map')).toBe(false);
  });
});
