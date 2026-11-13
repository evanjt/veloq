/**
 * Scenario: a notice inside a screen drew its own translucent tint of the
 * status colour, so a failed save, an expired session and the top-slot banner
 * each showed a different ground for the same tone.
 *
 * Expected behaviour: each notice sits on the banner's ground for its tone, in
 * both themes, with the body ink for its words, at the card radius.
 */

import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SaveErrorBanner } from '@/features/recording/components/SaveErrorBanner';
import { SessionExpiredNotice } from '@/features/auth/components/SessionExpiredNotice';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { noticePalette, type NoticeTone } from '@/shared/ui/NoticeBanner';
import { layout } from '@/theme';

let mockIsDark = false;
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

type Node = { props: { style?: unknown }; parent: Node | null };

/** The nearest view at or above `node` that paints a ground. */
function groundOf(node: Node): string | undefined {
  for (let n: Node | null = node; n; n = n.parent) {
    const bg = StyleSheet.flatten(n.props.style as StyleProp<TextStyle>)?.backgroundColor;
    if (typeof bg === 'string') return bg;
  }
  return undefined;
}

function inkOf(node: Node): string | undefined {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>)?.color as string | undefined;
}

describe.each([
  ['light', false],
  ['dark', true],
])('in the %s theme', (_name, dark) => {
  beforeEach(() => {
    mockIsDark = dark;
  });

  it.each<NoticeTone>(['error', 'warning', 'info', 'neutral'])(
    'draws a %s inline notice on the banner palette',
    async (tone) => {
      await render(<InlineNotice tone={tone} icon="leaf" title="Frost due" testID="notice" />);
      const ground = StyleSheet.flatten(screen.getByTestId('notice').props.style);
      const palette = noticePalette(tone, dark);

      expect(ground.backgroundColor).toBe(palette.bg);
      expect(ground.borderColor).toBe(palette.border);
      expect(ground.borderRadius).toBe(layout.borderRadius);
      expect(inkOf(screen.getByText('Frost due') as unknown as Node)).toBe(palette.text);
    }
  );

  it('draws a failed save on the error ground with the body ink', async () => {
    await render(
      <SaveErrorBanner
        errorMessage="recording.saveFailed"
        showPermissionFix={false}
        isOAuthLoading={false}
        onUpgradePermissions={jest.fn()}
      />
    );
    const message = screen.getByText('recording.saveFailed') as unknown as Node;

    expect(groundOf(message)).toBe(noticePalette('error', dark).bg);
    expect(inkOf(message)).toBe(noticePalette('error', dark).text);
  });

  it('draws an expired session on the warning ground with the body ink', async () => {
    await render(
      <SessionExpiredNotice
        notice={{ reason: 'signed_out', cachedAthleteId: null, heldRideStart: null }}
      />
    );
    const title = screen.getByText('login.sessionSignedOut') as unknown as Node;

    expect(groundOf(title)).toBe(noticePalette('warning', dark).bg);
    expect(inkOf(title)).toBe(noticePalette('warning', dark).text);
  });
});
