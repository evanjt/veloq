import { resolvedLocale } from '../../i18n/resolvedLocale';

describe('v040 sections body', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.join(__dirname, '../../../i18n/locales');

  vaultIt.each(fs.readdirSync(dir))('states a rule and not a result of the run, in %s', (file) => {
    const locale = resolvedLocale(file.replace('.json', ''));
    const body: string = locale.whatsNew.v040.rebuiltBody;
    // The first-person-plural "now cut by" form is a claim about the run that a
    // failed re-analysis falsifies; the body states the detector's property.
    expect(body.split(/[.。]/).filter((s) => s.trim()).length).toBe(1);
    expect(body).not.toMatch(/\b(now|jetzt|maintenant|ahora|agora|ora)\b/i);
  });
});
