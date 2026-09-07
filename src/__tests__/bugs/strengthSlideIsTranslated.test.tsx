/**
 * Scenario: the 0.3.0 strength tour slide is shown to an athlete on any of the
 * seventeen locales, and its Show Me is tapped.
 *
 * Expected behaviour: every string it draws comes from a translation key, and
 * Show Me lands on the strength sub-tab, where the body diagram it describes
 * lives. It drew six English literals and went to Fitness.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { StrengthSlide } from '@/features/settings/components/whatsNew/StrengthSlide';
import { WHATS_NEW_SLIDES } from '@/features/settings/components/whatsNew/slides';
import en from '@/i18n/locales/en-AU.json';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// The slide reaches the app barrel for `useTheme`, and the barrel pulls the
// IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// Every string the slide draws is rendered as its own key, so a literal that
// never went through `t()` stands out as plain English.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `[${key}]` }),
}));

jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  return { Canvas: View, RoundedRect: () => null };
});

function drawnText(tree: ReturnType<typeof render>): string[] {
  return tree.root.findAllByType('Text' as never).flatMap((node) => {
    const child = (node.props as { children?: unknown }).children;
    return typeof child === 'string' ? [child] : [];
  });
}

describe('the strength tour slide', () => {
  it('draws no string that did not come from a translation key', () => {
    const drawn = drawnText(render(<StrengthSlide />));

    expect(drawn.length).toBeGreaterThan(0);
    for (const text of drawn) {
      expect(text).toMatch(/^\[.+\]$/);
    }
  });

  it('names the muscle groups and the two weeks through keys that exist', () => {
    const drawn = drawnText(render(<StrengthSlide />));
    const lookup = en as unknown as Record<string, unknown>;

    for (const text of drawn) {
      const key = text.slice(1, -1);
      const value = key.split('.').reduce<unknown>((node, part) => {
        return node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined;
      }, lookup);
      expect(typeof value).toBe('string');
    }
  });

  it('sends Show Me to the strength sub-tab', () => {
    const strength = WHATS_NEW_SLIDES['0.3.0'].find(
      (slide) => slide.titleKey === 'whatsNew.v030.strengthTitle'
    );
    expect(strength?.showMeRoute).toBe('/insights?tab=strength');
  });
});
