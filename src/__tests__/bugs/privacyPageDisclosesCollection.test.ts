/**
 * Scenario: the store review reads the privacy page against the permissions
 * the build declares and the data the sign-in worker keeps.
 * Expected behaviour: while the page says the worker keeps an athlete ID and
 * an IP address, no language claims nothing is collected or that a tile
 * request carries nothing identifying; and every sensitive capability the app
 * declares has its own line on the page, in the markup and in the English,
 * Spanish and French tables.
 */
import * as fs from 'fs';
import * as path from 'path';
import { unsupportedClaimsIn } from '../../../scripts/validate-store-metadata';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const page = read('docs/privacy/index.html');
const appJson = JSON.parse(read('app.json')).expo;

type Lang = 'en' | 'es' | 'fr';
const LANGS: Lang[] = ['en', 'es', 'fr'];

function translationTables(): Record<Lang, Record<string, string>> {
  const m = page.match(/const translations = (\{[\s\S]*?\n {6}\});/);
  if (!m) throw new Error('the page carries no translations table');
  return new Function(`return ${m[1]}`)();
}

function markupText(key: string): string | null {
  const escaped = key.replace(/\./g, '\\.');
  const m = page.match(new RegExp(`data-i18n="${escaped}"[^>]*>([\\s\\S]*?)</(?:li|p|h2|h3)>`));
  return m ? m[1] : null;
}

const tables = translationTables();

type Capability = 'location' | 'bluetooth' | 'camera' | 'notifications' | 'purchases';

function pluginNames(): string[] {
  return (appJson.plugins as (string | [string, unknown])[]).map((p) =>
    Array.isArray(p) ? p[0] : p
  );
}

function declaredCapabilities(): Capability[] {
  const plugins = pluginNames();
  const androidPermissions: string[] = appJson.android.permissions ?? [];
  const iosModes: string[] = appJson.ios.infoPlist?.UIBackgroundModes ?? [];
  const found: Capability[] = [];
  if (
    androidPermissions.some((p) => /LOCATION/.test(p)) ||
    iosModes.includes('location') ||
    plugins.includes('expo-location')
  )
    found.push('location');
  if (plugins.includes('react-native-ble-plx')) found.push('bluetooth');
  if (plugins.includes('expo-camera')) found.push('camera');
  if (plugins.includes('expo-notifications') || androidPermissions.includes('POST_NOTIFICATIONS'))
    found.push('notifications');
  if (plugins.includes('react-native-iap')) found.push('purchases');
  return found;
}

const DISCLOSURE: Record<Capability, { key: string; phrase: Record<Lang, RegExp> }> = {
  location: {
    key: 'permissions.location',
    phrase: { en: /location/i, es: /ubicación/i, fr: /localisation/i },
  },
  bluetooth: {
    key: 'permissions.bluetooth',
    phrase: { en: /Bluetooth/, es: /Bluetooth/, fr: /Bluetooth/ },
  },
  camera: {
    key: 'permissions.camera',
    phrase: { en: /camera/i, es: /cámara/i, fr: /caméra/i },
  },
  notifications: {
    key: 'permissions.notifications',
    phrase: { en: /notification/i, es: /notificaci/i, fr: /notification/i },
  },
  purchases: {
    key: 'purchases.content',
    phrase: { en: /purchase/i, es: /compra/i, fr: /achat/i },
  },
};

describe('the privacy page claims no less collection than the app does', () => {
  it('names the athlete ID and IP address the sign-in worker keeps', () => {
    for (const lang of LANGS) {
      expect(tables[lang]['thirdParty.cloudflare.item2']).toMatch(/athlete|atleta|athlète/i);
      expect(tables[lang]['thirdParty.cloudflare.item3']).toMatch(/\bIP\b/);
    }
  });

  it('makes no claim the listings are refused, in any language', () => {
    expect(unsupportedClaimsIn(page)).toEqual([]);
  });

  it('says what a tile request carries in every language', () => {
    for (const lang of LANGS) {
      expect(tables[lang]['thirdParty.maps.desc']).toMatch(/\bIP\b/);
    }
    expect(markupText('thirdParty.maps.desc')).toMatch(/\bIP\b/);
  });
});

describe('every sensitive capability the app declares is on the privacy page', () => {
  it('finds the capabilities the build declares', () => {
    expect(declaredCapabilities()).toEqual([
      'location',
      'bluetooth',
      'camera',
      'notifications',
      'purchases',
    ]);
  });

  it.each(declaredCapabilities())('%s has a line in the markup and every table', (capability) => {
    const { key, phrase } = DISCLOSURE[capability];
    expect(markupText(key)).toMatch(phrase.en);
    for (const lang of LANGS) {
      expect(tables[lang][key]).toMatch(phrase[lang]);
    }
  });

  it('every key the markup shows is translated in every table', () => {
    const keys = [...page.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    for (const lang of LANGS) {
      expect(keys.filter((k) => !(k in tables[lang]))).toEqual([]);
    }
  });
});
