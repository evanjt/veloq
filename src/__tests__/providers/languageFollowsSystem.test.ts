/**
 * Scenario: an athlete installs on an English phone and later switches the phone to German, or
 * picks a language for the app alone in the platform's own per-app language setting.
 *
 * Expected behaviour: a new install follows the phone, at launch and on every return to the
 * foreground, until a language is picked in the app. An install that saved the phone's language
 * at its first launch moves to following the phone once; a pick that differs from the phone stays.
 * Where the platform keeps a per-app language, the app writes its choice there and adopts one made
 * there, so the two settings never disagree.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { AppState } from 'react-native';
import { i18n, initialiseI18n } from '@/i18n';
import {
  SYSTEM_LANGUAGE,
  followPlatformLanguage,
  initialiseLanguage,
  resolveLanguageToLocale,
  startLanguageFollower,
  useLanguageStore,
} from '@/shared/app/LanguageStore';

const mockPlatform: { tag: string | null; system: string[] | null; writes: string[] } = {
  tag: null,
  system: null,
  writes: [],
};

jest.mock('@/shared/app/appLocale', () => ({
  readPlatformLanguage: () => mockPlatform.tag,
  readSystemLocales: () => mockPlatform.system,
  writePlatformLanguage: (tag: string) => {
    mockPlatform.writes.push(tag);
    mockPlatform.tag = tag;
  },
}));

// No engine is open, as on a signed-out launch: settings read and write AsyncStorage.
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

const STORAGE_KEY = 'veloq-language-preference';
const mockGetLocales = Localization.getLocales as jest.Mock;

function phoneSpeaks(languageTag: string) {
  mockGetLocales.mockReturnValue([{ languageTag, languageCode: languageTag.split('-')[0] }]);
}

function relaunch() {
  useLanguageStore.setState({ language: null, isInitialised: false });
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(async () => {
  await AsyncStorage.clear();
  relaunch();
  mockPlatform.tag = null;
  mockPlatform.system = null;
  mockPlatform.writes = [];
  phoneSpeaks('en-GB');
});

describe('a new install follows the phone', () => {
  it('stores the system choice rather than the language it detected', async () => {
    const locale = await initialiseLanguage();

    expect(locale).toBe('en-GB');
    expect(useLanguageStore.getState().language).toBe(SYSTEM_LANGUAGE);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(SYSTEM_LANGUAGE);
  });

  it('speaks German at the next launch after the phone moves to German', async () => {
    await initialiseLanguage();
    phoneSpeaks('de-DE');
    relaunch();

    expect(await initialiseLanguage()).toBe('de-DE');
  });

  it('speaks German on return to the foreground after the phone moves to German', async () => {
    await initialiseLanguage();
    await i18n.changeLanguage('en-GB');
    phoneSpeaks('de-DE');

    await followPlatformLanguage();

    expect(i18n.language).toBe('de-DE');
    expect(useLanguageStore.getState().language).toBe(SYSTEM_LANGUAGE);
  });

  it('keeps an explicit pick when the phone moves', async () => {
    await initialiseLanguage();
    await useLanguageStore.getState().setLanguage('fr');
    phoneSpeaks('de-DE');

    await followPlatformLanguage();
    expect(i18n.language).toBe('fr');
    relaunch();
    expect(await initialiseLanguage()).toBe('fr');
  });

  it('goes back to following the phone when System is picked', async () => {
    await initialiseLanguage();
    await useLanguageStore.getState().setLanguage('fr');
    phoneSpeaks('ja');

    await useLanguageStore.getState().setLanguage(SYSTEM_LANGUAGE);

    expect(i18n.language).toBe('ja');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(SYSTEM_LANGUAGE);
  });

  it('re-reads the phone when the app returns to the foreground', async () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: string) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    await initialiseLanguage();
    const stop = startLanguageFollower();
    phoneSpeaks('it');

    listeners.forEach((listener) => listener('active'));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(i18n.language).toBe('it');
    stop();
    spy.mockRestore();
  });
});

describe('an install that saved its first-launch detection', () => {
  it('moves to following the phone when the saved language is the phone language', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'en-GB');

    await initialiseLanguage();

    expect(useLanguageStore.getState().language).toBe(SYSTEM_LANGUAGE);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(SYSTEM_LANGUAGE);
  });

  it('keeps a dialect that differs from the phone as an explicit pick', async () => {
    phoneSpeaks('de-DE');
    await AsyncStorage.setItem(STORAGE_KEY, 'de-CH');

    expect(await initialiseLanguage()).toBe('de-CH');
    expect(useLanguageStore.getState().language).toBe('de-CH');
  });

  it('keeps English (AU) on a British phone as an explicit pick', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'en-AU');

    expect(await initialiseLanguage()).toBe('en-AU');
    expect(useLanguageStore.getState().language).toBe('en-AU');
  });

  it('moves once, so the phone language picked later stays a pick', async () => {
    await initialiseLanguage();
    await useLanguageStore.getState().setLanguage('en-GB');
    relaunch();

    await initialiseLanguage();

    expect(useLanguageStore.getState().language).toBe('en-GB');
  });
});

describe('where the platform keeps a per-app language', () => {
  beforeEach(() => {
    mockPlatform.tag = '';
    mockPlatform.system = ['en-GB'];
  });

  it('writes an in-app pick to the platform, and clears it for System', async () => {
    await initialiseLanguage();

    await useLanguageStore.getState().setLanguage('de-CH');
    expect(mockPlatform.tag).toBe('de-CH');

    await useLanguageStore.getState().setLanguage(SYSTEM_LANGUAGE);
    expect(mockPlatform.tag).toBe('');
  });

  it('resolves System from the phone list, not the per-app language it is clearing', async () => {
    await initialiseLanguage();
    await useLanguageStore.getState().setLanguage('fr');
    // The process keeps the per-app locale until the configuration change lands.
    phoneSpeaks('fr');

    await useLanguageStore.getState().setLanguage(SYSTEM_LANGUAGE);

    expect(i18n.language).toBe('en-GB');
  });

  it('writes an existing pick to the platform at the first launch that can', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'de-CH');

    await initialiseLanguage();

    expect(mockPlatform.tag).toBe('de-CH');
  });

  it('adopts a language picked in the platform settings', async () => {
    await initialiseLanguage();
    mockPlatform.tag = 'it';

    await followPlatformLanguage();

    expect(useLanguageStore.getState().language).toBe('it');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('it');
    expect(i18n.language).toBe('it');
  });

  it('adopts the platform going back to the phone language', async () => {
    await initialiseLanguage();
    await useLanguageStore.getState().setLanguage('pl');
    mockPlatform.tag = '';

    await followPlatformLanguage();

    expect(useLanguageStore.getState().language).toBe(SYSTEM_LANGUAGE);
    expect(i18n.language).toBe('en-GB');
  });

  it('adopts a platform pick made while the app was not running', async () => {
    await initialiseLanguage();
    mockPlatform.tag = 'de-AT';
    relaunch();

    expect(await initialiseLanguage()).toBe('de-DE');
    expect(useLanguageStore.getState().language).toBe('de-DE');
  });

  it('writes a restored choice to the platform rather than undoing it', async () => {
    await initialiseLanguage();
    await AsyncStorage.setItem(STORAGE_KEY, 'nl');
    relaunch();

    expect(await initialiseLanguage()).toBe('nl');
    expect(mockPlatform.tag).toBe('nl');
  });

  it('writes nothing when the two already agree', async () => {
    await initialiseLanguage();
    mockPlatform.writes = [];

    await followPlatformLanguage();
    relaunch();
    await initialiseLanguage();

    expect(mockPlatform.writes).toEqual([]);
  });
});

describe('resolveLanguageToLocale', () => {
  it('resolves System to the phone language', () => {
    phoneSpeaks('pt-BR');
    expect(resolveLanguageToLocale(SYSTEM_LANGUAGE)).toBe('pt-BR');
  });
});
