/**
 * Scenario: an athlete on 0.3.8 upgrades and opens What's New. Six changes reach them that no
 * other slide names: sections may be re-drawn, visit counts can fall, Google no longer restores the
 * library, the detection strictness setting is gone, the Android insights channel is replaced, and
 * the app is portrait only.
 *
 * Expected behaviour: the 0.4.0 slides include one that names each change with a caption, and
 * every line it shows is written in the reference locale.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { getSlidesSince } from '@/features/settings/components/whatsNew/slides';
import { ChangesSlide } from '@/features/settings/components/whatsNew/ChangesSlide';
import { resolvedLocale } from '../../i18n/resolvedLocale';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

const CHANGES = ['Sections', 'Visits', 'Backup', 'Detection', 'Notifications', 'Portrait'] as const;

const english = resolvedLocale('en-GB') as unknown as {
  whatsNew: { v040: Record<string, string> };
};

describe("What's New changes slide", () => {
  it('is offered to an athlete upgrading from 0.3.8', () => {
    const titles = getSlidesSince('0.3.8').map((slide) => slide.titleKey);
    expect(titles).toContain('whatsNew.v040.changesTitle');
  });

  it('names each change as a label with a caption', () => {
    render(<ChangesSlide />);
    for (const change of CHANGES) {
      expect(screen.getByText(`whatsNew.v040.changes${change}Label`)).toBeTruthy();
      expect(screen.getByText(`whatsNew.v040.changes${change}Caption`)).toBeTruthy();
    }
  });

  it('writes every line it shows in the reference locale', () => {
    for (const change of CHANGES) {
      for (const part of ['Label', 'Caption'] as const) {
        const key = `changes${change}${part}`;
        const line = english.whatsNew.v040[key];
        expect(typeof line).toBe('string');
        expect(line).not.toBe(`whatsNew.v040.${key}`);
      }
    }
  });
});
