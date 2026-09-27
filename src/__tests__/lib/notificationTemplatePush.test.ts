/**
 * Scenario: a push arrives with the app killed. The native handler builds the
 * body in Rust, and the crate holds no locale bundles of its own.
 *
 * Expected behaviour: whatever locale the app was last running in, the fifteen
 * resolved templates are already in the engine, and a bundle that has not
 * loaded yet is never the thing that gets stored.
 */

import { initializeI18n, changeLanguage, i18n } from '@/i18n';
import {
  NOTIFICATION_TEMPLATE_KEYS,
  pushNotificationTemplates,
} from '@/i18n/notificationTemplates';

const setNotificationTemplates = jest.fn();

let mockEngine: { setNotificationTemplates: jest.Mock } | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

beforeAll(async () => {
  await initializeI18n('en-AU');
});

beforeEach(async () => {
  setNotificationTemplates.mockClear();
  mockEngine = { setNotificationTemplates };
  await changeLanguage('en-AU');
});

describe('pushNotificationTemplates', () => {
  it('stores every key the body builder formats with', () => {
    pushNotificationTemplates();

    expect(setNotificationTemplates).toHaveBeenCalledTimes(1);
    const [locale, templates] = setNotificationTemplates.mock.calls[0];
    expect(locale).toBe('en-AU');
    expect(templates.map((pair: { key: string }) => pair.key)).toEqual([
      ...NOTIFICATION_TEMPLATE_KEYS,
    ]);
  });

  it('stores the resolved sentence, not the key', () => {
    pushNotificationTemplates();

    const [, templates] = setNotificationTemplates.mock.calls[0];
    const byKey = new Map<string, string>(
      templates.map((pair: { key: string; value: string }) => [pair.key, pair.value])
    );
    expect(byKey.get('notifications.activityBody.onRoute')).toBe('On {{name}}');
    expect(byKey.get('notifications.activityBody.routePrDelta')).toBe(
      'Route PR on {{name}} ({{delta}} faster)'
    );
  });

  it('keeps the placeholders for Rust to substitute', () => {
    pushNotificationTemplates();

    const [, templates] = setNotificationTemplates.mock.calls[0];
    const delta = templates.find(
      (pair: { key: string }) => pair.key === 'notifications.activityBody.sectionPrDelta'
    );
    expect(delta.value).toContain('{{name}}');
    expect(delta.value).toContain('{{delta}}');
  });

  it('follows a locale change', async () => {
    await changeLanguage('ja');
    pushNotificationTemplates();

    const [locale, templates] = setNotificationTemplates.mock.calls[0];
    expect(locale).toBe('ja');
    const onRoute = templates.find(
      (pair: { key: string }) => pair.key === 'notifications.activityBody.onRoute'
    );
    expect(onRoute.value).not.toBe('On {{name}}');
    expect(onRoute.value).not.toBe('notifications.activityBody.onRoute');
  });

  it('writes nothing when there is no engine', () => {
    mockEngine = null;

    expect(() => pushNotificationTemplates()).not.toThrow();
    expect(setNotificationTemplates).not.toHaveBeenCalled();
  });

  it('keeps the stored bundle when a key resolves as itself', () => {
    const resolve = jest.spyOn(i18n, 't').mockImplementation(((key: string) => key) as never);

    pushNotificationTemplates();

    expect(setNotificationTemplates).not.toHaveBeenCalled();
    resolve.mockRestore();
  });
});

describe('the locale bundles', () => {
  it('carry every template key', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../i18n/locales');
    const files = fs.readdirSync(dir).filter((name: string) => name.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bundle = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const key of NOTIFICATION_TEMPLATE_KEYS) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === 'object'
                ? (node as Record<string, unknown>)[part]
                : undefined,
            bundle
          );
        expect(`${file}: ${key} is ${typeof value}`).toBe(`${file}: ${key} is string`);
      }
    }
  });
});
