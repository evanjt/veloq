/**
 * Scenario: a part of a screen fails to render, a launch initialiser rejects,
 * or a workout's intervals and a route PR are drawn, for an athlete reading
 * the app in German or French.
 *
 * Expected behaviour: every word on those surfaces comes from the athlete's
 * locale, the crash log keeps a stable English name, and no failure tells the
 * athlete to restart the app: each one offers a retry instead.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import { ComponentErrorBoundary } from '@/shared/ui/ComponentErrorBoundary';
import { StartupErrorBanner } from '@/shared/ui/StartupErrorBanner';
import { intervalTypeLabel } from '@/features/activity/lib/intervalTypeLabel';
import { formatPrDelta } from '@/shared/format/format';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { IntervalKind } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('@/shared/app/useTheme', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});

function Broken(): React.ReactElement {
  throw new Error('render failed');
}

function textOf(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const { children } = node as { children?: unknown[] };
  return (children ?? []).flatMap(textOf);
}

const RESTART = /restart|neu ?start|starte .* neu|redémarr/i;

let consoleError: jest.SpyInstance;

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  consoleError.mockRestore();
  await changeLanguage('en-GB');
});

describe('a part of a screen that could not render', () => {
  it('names the part in German and offers a retry rather than a restart', async () => {
    await changeLanguage('de-DE');
    const tree = await render(
      <ComponentErrorBoundary part="map3d" debugName="3D Map">
        <Broken />
      </ComponentErrorBoundary>
    );

    const shown = textOf(tree.toJSON()).join(' ');
    expect(shown).toContain(i18n.t('errorState.part.map3d'));
    expect(i18n.t('errorState.part.map3d')).not.toBe('errorState.part.map3d');
    expect(shown).not.toContain('3D Map');
    expect(shown).not.toMatch(RESTART);
    expect(tree.getByText(i18n.t('common.retry'))).toBeTruthy();
  });

  it('keeps the English name for the crash log', async () => {
    await changeLanguage('de-DE');
    await render(
      <ComponentErrorBoundary part="map" debugName="Map">
        <Broken />
      </ComponentErrorBoundary>
    );

    expect(recordBoundaryCrash).toHaveBeenCalledWith(
      expect.any(Error),
      expect.anything(),
      expect.objectContaining({ screen: 'Map' })
    );
  });

  it('draws the part again when the athlete retries', async () => {
    let fail = true;
    function Flaky(): React.ReactElement {
      if (fail) throw new Error('render failed');
      return <Text>drawn</Text>;
    }
    const tree = await render(
      <ComponentErrorBoundary part="map" debugName="Map">
        <Flaky />
      </ComponentErrorBoundary>
    );

    fail = false;
    await fireEvent.press(tree.getByText(i18n.t('common.retry')));
    expect(tree.getByText('drawn')).toBeTruthy();
  });
});

describe('the launch banner', () => {
  it('offers a retry that re-runs what failed, and never says to restart', async () => {
    const onRetry = jest.fn();
    const tree = await render(
      <StartupErrorBanner areas={['maps']} onRetry={onRetry} onDismiss={() => {}} />
    );

    expect(textOf(tree.toJSON()).join(' ')).not.toMatch(RESTART);
    await fireEvent.press(tree.getByText(i18n.t('common.retry')));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('interval type words', () => {
  it('reads a warm up in the athlete language, not the raw type', async () => {
    await changeLanguage('de-DE');
    const shown = intervalTypeLabel({ kind: IntervalKind.Warmup, zone: null, zoneColoured: false });

    expect(shown).toBe(i18n.t('intervalTypes.warmup.short'));
    expect(shown).not.toBe('WARMUP');
    expect(shown).not.toBe('intervalTypes.warmup.short');
  });

  it('gives a screen reader the long form', async () => {
    await changeLanguage('de-DE');
    const spoken = intervalTypeLabel(
      { kind: IntervalKind.Recovery, zone: null, zoneColoured: false },
      'long'
    );

    expect(spoken).toBe(i18n.t('intervalTypes.recovery.long'));
    expect(spoken).not.toBe('Rec');
  });

  it('calls a type it does not know other, rather than showing the raw type', async () => {
    const shown = intervalTypeLabel({ kind: IntervalKind.Other, zone: null, zoneColoured: false });

    expect(shown).toBe(i18n.t('intervalTypes.other.short'));
  });
});

describe('the route PR badge', () => {
  it('builds its words in French', async () => {
    await changeLanguage('fr');

    expect(formatPrDelta(12)).not.toMatch(/^PR\+/);
    expect(formatPrDelta(12)).toContain('12');
    expect(formatPrDelta(72)).toContain('1:12');
  });
});
