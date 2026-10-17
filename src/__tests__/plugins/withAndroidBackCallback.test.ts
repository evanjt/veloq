/**
 * Scenario: the app opts in to predictive back, so Android 13 and later deliver
 * the system back only to the activity's dispatcher callbacks. React Native
 * registers its callback only on Android 16 with a targetSdk 36 build. On
 * Android 13 to 15 nothing is registered, back never reaches JavaScript, and
 * the system sends the app home from any screen, activity detail included.
 *
 * Expected behaviour: the generated `MainActivity` registers a callback that
 * hands back to React Native wherever React Native registers none, and turns it
 * off while React Native's default back runs, so a back JavaScript declines
 * still leaves the app rather than coming straight back to JavaScript.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const { withBackCallback } = require('../../plugins/with-android-back-callback') as {
  withBackCallback: (contents: string) => string;
};

const ROOT = join(__dirname, '../../..');

/** The Kotlin `MainActivity` Expo generation starts from. */
function templateMainActivity(): string {
  const template = join(
    dirname(require.resolve('expo/package.json', { paths: [ROOT] })),
    'template.tgz'
  );
  const entry = execFileSync('tar', ['-tzf', template], { encoding: 'utf8' })
    .split('\n')
    .find((path) => path.endsWith('/MainActivity.kt'));
  if (!entry) throw new Error('the Expo template carries no MainActivity.kt');
  return execFileSync('tar', ['-xzOf', template, entry], { encoding: 'utf8' });
}

/** The body of the named override, up to the next override or the end of the class. */
function overrideBody(source: string, name: string): string {
  const start = source.indexOf(`override fun ${name}(`);
  if (start < 0) throw new Error(`no ${name} override`);
  const next = source.indexOf('override fun ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

/** The name of the callback the activity adds to its back dispatcher. */
function registeredCallback(source: string): string {
  const match = overrideBody(source, 'onCreate').match(
    /onBackPressedDispatcher\.addCallback\(this, (\w+)\)/
  );
  if (!match) throw new Error('onCreate adds no back callback');
  return match[1];
}

describe('with-android-back-callback', () => {
  it('registers a back callback in onCreate after the activity is created', () => {
    const onCreate = overrideBody(withBackCallback(templateMainActivity()), 'onCreate');

    const created = onCreate.indexOf('super.onCreate(null)');
    const added = onCreate.indexOf('onBackPressedDispatcher.addCallback(this, ');
    expect(created).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThan(created);
  });

  it('registers it wherever React Native registers none', () => {
    const onCreate = overrideBody(withBackCallback(templateMainActivity()), 'onCreate');

    expect(onCreate).toMatch(
      /if \(Build\.VERSION\.SDK_INT < 36 \|\| applicationInfo\.targetSdkVersion < 36\) \{\s*onBackPressedDispatcher\.addCallback/
    );
  });

  it('hands the back to React Native with itself off, so an unloaded app still leaves', () => {
    const generated = withBackCallback(templateMainActivity());
    const callback = registeredCallback(generated);

    const declaration = generated.match(
      new RegExp(
        `private val ${callback} = object : OnBackPressedCallback\\(true\\) \\{\\s*override fun handleOnBackPressed\\(\\) \\{([^}]*)\\}`
      )
    );
    expect(declaration).not.toBeNull();
    const steps = declaration![1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(steps).toEqual(['isEnabled = false', 'onBackPressed()', 'isEnabled = true']);
    expect(generated).toMatch(/^import androidx\.activity\.OnBackPressedCallback$/m);
  });

  it('turns the callback off before the default back runs', () => {
    const generated = withBackCallback(templateMainActivity());
    const callback = registeredCallback(generated);
    const defaultBack = overrideBody(generated, 'invokeDefaultOnBackPressed');

    const off = defaultBack.indexOf(`${callback}.isEnabled = false`);
    expect(off).toBeGreaterThanOrEqual(0);
    expect(off).toBeLessThan(defaultBack.indexOf('moveTaskToBack'));
    expect(off).toBeLessThan(defaultBack.indexOf('super.invokeDefaultOnBackPressed()'));
    expect(defaultBack).toContain(`window.decorView.post { ${callback}.isEnabled = true }`);
  });

  it('adds everything once when generation runs twice', () => {
    const once = withBackCallback(templateMainActivity());
    const twice = withBackCallback(once);

    expect(twice).toBe(once);
    expect(twice.match(/onBackPressedDispatcher\.addCallback/g)).toHaveLength(1);
    expect(twice.match(/^import androidx\.activity\.OnBackPressedCallback$/gm)).toHaveLength(1);
  });

  it('keeps the rest of the template', () => {
    const template = templateMainActivity();
    const generated = withBackCallback(template);

    for (const line of template.split('\n')) {
      expect(generated).toContain(line);
    }
  });

  it('refuses a MainActivity without the default back override', () => {
    const template = templateMainActivity();
    const start = template.indexOf('  /**\n    * Align the back button');
    expect(start).toBeGreaterThan(0);

    expect(() => withBackCallback(template.slice(0, start) + '}\n')).toThrow();
  });

  it('refuses a MainActivity it cannot find the class of', () => {
    expect(() => withBackCallback('package com.example.orchard\n')).toThrow();
  });
});

describe('the app config', () => {
  const variant = process.env.APP_VARIANT;

  afterEach(() => {
    if (variant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = variant;
  });

  it.each(['production', 'dev'])('runs the plugin on the %s identity', (identity) => {
    process.env.APP_VARIANT = identity;
    const appJson = require('../../../app.json');
    const appConfig = require('../../../app.config.js');

    const config = appConfig({ config: appJson.expo });

    expect(config.plugins).toContain('./src/plugins/with-android-back-callback');
  });
});
