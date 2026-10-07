import da from '@/i18n/locales/da.json';
import deDE from '@/i18n/locales/de-DE.json';

describe('sign-in warnings preserve the keep path', () => {
  it('tells a Danish athlete that signing in to the other account keeps the library', () => {
    expect(da.alerts.accountChangeMessage).not.toMatch(/i stedet for at beholde/);
    expect(da.alerts.accountChangeMessage).toMatch(/den konto for at beholde dem/);
  });

  it.each([
    'accountChangeMessage',
    'accountChangeDemoMessage',
    'accountChangeUnknownDemoMessage',
  ] as const)('addresses a German athlete as du and names the other account in %s', (key) => {
    expect(deDE.alerts[key]).not.toMatch(/\bSie\b|diesem Konto/);
    expect(deDE.alerts[key]).toMatch(/dem anderen Konto/);
  });

  it('addresses the athlete as du when signing out and deleting local data', () => {
    expect(deDE.alerts.disconnectAndClearMessage).toMatch(/\bdich\b/);
    expect(deDE.alerts.disconnectAndClearMessage).not.toMatch(/\bSie\b/);
  });

  it('keeps the same form of address in the tile and background task messages', () => {
    expect(deDE.settings.tileCacheLimitHint).not.toMatch(/\bSie\b/);
    expect(deDE.settings.stillRunning).toMatch(/\bDu\b|\bdu\b/);
    expect(deDE.settings.stillRunning).not.toMatch(/\bSie\b/);
  });
});
