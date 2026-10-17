/**
 * Scenario: react-native-screens keeps an offscreen tab inside a `Freeze`
 * from react-freeze, which suspends the subtree instead of unmounting it.
 * Every theme reader is a hook that subscribes to the preference store or to
 * the system colour scheme.
 *
 * Expected behaviour: a colour-scheme flip while the subtree is frozen commits
 * nothing inside it, and at thaw every reader paints the scheme in force at
 * that moment without having mounted a second time.
 */

import React, { act, memo, useEffect } from 'react';
import { render } from '@testing-library/react-native';
import { Text, type ColorSchemeName } from 'react-native';
import { Freeze } from 'react-freeze';

import { setThemePreference, useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { useTheme } from '@/shared/app/useTheme';
import { useChartColors } from '@/shared/charts/useChartColors';
import { colors, darkColors } from '@/theme/colors';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

let mockSystemScheme: 'light' | 'dark' = 'light';
const mockSystemListeners = new Set<() => void>();

function mockSetSystemScheme(scheme: 'light' | 'dark'): void {
  mockSystemScheme = scheme;
  mockSystemListeners.forEach((listener) => listener());
}

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => {
  const { useSyncExternalStore } = require('react');
  return {
    ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
    __esModule: true,
    default: function useMockColorScheme() {
      return useSyncExternalStore(
        (listener: () => void) => {
          mockSystemListeners.add(listener);
          return () => mockSystemListeners.delete(listener);
        },
        () => mockSystemScheme
      );
    },
  };
});

type Scheme = NonNullable<ColorSchemeName>;

interface Ledger {
  mounts: Record<string, number>;
  commits: Record<string, Scheme[]>;
}

let ledger: Ledger;

function useLedger(name: string, scheme: Scheme): void {
  // Every commit of a probe, in order. A render that React discards never
  // reaches an effect, so this is what was painted and not what was computed.
  useEffect(() => {
    (ledger.commits[name] ??= []).push(scheme);
  });
  useEffect(() => {
    ledger.mounts[name] = (ledger.mounts[name] ?? 0) + 1;
  }, [name]);
}

function ThemeHookProbe() {
  const theme = useTheme();
  const scheme: Scheme = theme.isDark ? 'dark' : 'light';
  useLedger('useTheme', scheme);
  return <Text testID="useTheme">{`${scheme}:${theme.colors.background}`}</Text>;
}

function ChartColorsProbe() {
  const chart = useChartColors();
  const scheme: Scheme = chart.fitness === darkColors.fitness ? 'dark' : 'light';
  useLedger('useChartColors', scheme);
  return <Text testID="useChartColors">{scheme}</Text>;
}

function BareSchemeProbe() {
  const scheme = useResolvedColorScheme();
  useLedger('useResolvedColorScheme', scheme);
  return <Text testID="useResolvedColorScheme">{scheme}</Text>;
}

const MemoSchemeProbe = memo(function MemoSchemeProbe() {
  const scheme = useResolvedColorScheme();
  useLedger('memo', scheme);
  return <Text testID="memo">{scheme}</Text>;
});

const PROBES = ['useTheme', 'useChartColors', 'useResolvedColorScheme', 'memo'] as const;

function Tab({ frozen }: { frozen: boolean }) {
  return (
    <Freeze freeze={frozen}>
      <ThemeHookProbe />
      <ChartColorsProbe />
      <BareSchemeProbe />
      <MemoSchemeProbe />
    </Freeze>
  );
}

const painted = (api: Awaited<ReturnType<typeof render>>, scheme: Scheme) => {
  const background = scheme === 'dark' ? darkColors.surfacePage : colors.surfacePage;
  expect(api.getByTestId('useTheme').props.children).toBe(`${scheme}:${background}`);
  for (const name of PROBES.filter((n) => n !== 'useTheme')) {
    expect(api.getByTestId(name).props.children).toBe(scheme);
  }
};

const lastCommit = (name: string) => ledger.commits[name]?.at(-1);

async function setPreference(preference: 'system' | 'light' | 'dark'): Promise<void> {
  await act(async () => {
    await setThemePreference(preference);
  });
}

beforeEach(async () => {
  ledger = { mounts: {}, commits: {} };
  mockSystemScheme = 'light';
  await setPreference('light');
});

describe('a frozen subtree and a colour-scheme flip', () => {
  it('flips a subtree that is not frozen at once (control)', async () => {
    const api = await render(<Tab frozen={false} />);
    painted(api, 'light');

    await setPreference('dark');

    painted(api, 'dark');
    for (const name of PROBES) {
      expect(lastCommit(name)).toBe('dark');
      expect(ledger.mounts[name]).toBe(1);
    }
  });

  it('commits nothing while frozen, then paints the new scheme at thaw without remounting', async () => {
    const api = await render(<Tab frozen={false} />);
    await api.rerender(<Tab frozen />);
    const commitsBefore = Object.fromEntries(PROBES.map((n) => [n, ledger.commits[n]?.length]));

    await setPreference('dark');

    for (const name of PROBES) {
      expect(ledger.commits[name]?.length).toBe(commitsBefore[name]);
      expect(lastCommit(name)).toBe('light');
    }

    await api.rerender(<Tab frozen={false} />);

    painted(api, 'dark');
    for (const name of PROBES) {
      expect(lastCommit(name)).toBe('dark');
      expect(ledger.mounts[name]).toBe(1);
    }
  });

  it('shows no stale scheme after two flips that end where they began', async () => {
    const api = await render(<Tab frozen={false} />);
    await api.rerender(<Tab frozen />);

    await setPreference('dark');
    await setPreference('light');
    await api.rerender(<Tab frozen={false} />);

    painted(api, 'light');
    for (const name of PROBES) {
      expect(lastCommit(name)).toBe('light');
      expect(ledger.mounts[name]).toBe(1);
    }
  });

  it('follows the system scheme at thaw when the preference is system', async () => {
    await setPreference('system');
    const api = await render(<Tab frozen={false} />);
    painted(api, 'light');
    await api.rerender(<Tab frozen />);
    const commitsBefore = Object.fromEntries(PROBES.map((n) => [n, ledger.commits[n]?.length]));

    await act(() => mockSetSystemScheme('dark'));

    for (const name of PROBES) {
      expect(ledger.commits[name]?.length).toBe(commitsBefore[name]);
    }

    await api.rerender(<Tab frozen={false} />);

    painted(api, 'dark');
    for (const name of PROBES) {
      expect(lastCommit(name)).toBe('dark');
      expect(ledger.mounts[name]).toBe(1);
    }
  });

  it('ignores a system flip at thaw when the preference is explicit', async () => {
    const api = await render(<Tab frozen={false} />);
    await api.rerender(<Tab frozen />);

    await act(() => mockSetSystemScheme('dark'));
    await api.rerender(<Tab frozen={false} />);

    painted(api, 'light');
    for (const name of PROBES) {
      expect(ledger.mounts[name]).toBe(1);
    }
  });
});
