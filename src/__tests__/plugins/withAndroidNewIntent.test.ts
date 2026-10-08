/**
 * Scenario: the app's one activity is `singleTask`. When the system has killed
 * its process but kept the task, a widget, shortcut or notification tap
 * recreates the activity with the intent the task first started with and hands
 * the tapped link to `onNewIntent`, which React Native drops while the app is
 * still loading. `getInitialURL` reads the activity's intent, so it answers
 * with the stale first link and the tap opens the Feed or another sport.
 *
 * Expected behaviour: the generated `MainActivity` makes each new intent its
 * own, so the launch link is the one the athlete tapped, and generation adds
 * that once however often it runs.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const { withNewIntentKept } = require('../../plugins/with-android-new-intent');

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

/** The body of the `onNewIntent` override, or null when there is none. */
function onNewIntentBody(source: string): string | null {
  const match = source.match(/override fun onNewIntent\(intent: Intent\) \{([^}]*)\}/);
  return match ? match[1] : null;
}

describe('with-android-new-intent', () => {
  it('makes a new intent the activity intent before React Native sees it', () => {
    const generated = withNewIntentKept(templateMainActivity());

    const body = onNewIntentBody(generated);
    expect(body).not.toBeNull();
    const kept = body!.indexOf('setIntent(intent)');
    const forwarded = body!.indexOf('super.onNewIntent(intent)');
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(forwarded).toBeGreaterThan(kept);
    expect(generated).toMatch(/^import android\.content\.Intent$/m);
  });

  it('places the override inside MainActivity', () => {
    const generated = withNewIntentKept(templateMainActivity());

    const classStart = generated.indexOf('class MainActivity : ReactActivity() {');
    expect(classStart).toBeGreaterThanOrEqual(0);
    expect(generated.indexOf('override fun onNewIntent')).toBeGreaterThan(classStart);
  });

  it('adds the override once when generation runs twice', () => {
    const once = withNewIntentKept(templateMainActivity());
    const twice = withNewIntentKept(once);

    expect(twice).toBe(once);
    expect(twice.match(/override fun onNewIntent/g)).toHaveLength(1);
    expect(twice.match(/^import android\.content\.Intent$/gm)).toHaveLength(1);
  });

  it('keeps the rest of the template', () => {
    const template = templateMainActivity();
    const generated = withNewIntentKept(template);

    for (const line of template.split('\n')) {
      expect(generated).toContain(line);
    }
  });

  it('refuses a MainActivity it cannot find the class of', () => {
    expect(() => withNewIntentKept('package com.example.orchard\n')).toThrow();
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

    expect(config.plugins).toContain('./src/plugins/with-android-new-intent');
  });
});
