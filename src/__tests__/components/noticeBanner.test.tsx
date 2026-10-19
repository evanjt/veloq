/**
 * Scenario: the top-slot banner says something went wrong, needs a look, is
 * for information, or is simply a state. A failure drawn the same as a caution
 * tells the athlete nothing, and a banner whose action drops to a second row
 * takes twice the slot.
 *
 * Expected behaviour: each tone has its own tinted ground in both themes, the
 * title and detail clear 4.5:1 on it and the icon 3:1, and a banner with one
 * action draws that action on the title's own row, with an icon close beside
 * it rather than a second text button. Past the large-text cap the controls
 * stack under the text, where one row has no room for them.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { NoticeBanner, noticePalette, type NoticeTone } from '@/shared/ui/NoticeBanner';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const AA_TEXT = 4.5;
const AA_MARK = 3;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TONES: NoticeTone[] = ['error', 'warning', 'info', 'neutral'];
const CASES = TONES.flatMap((tone) => [
  [tone, false],
  [tone, true],
]) as [NoticeTone, boolean][];

describe('the banner palette', () => {
  it.each(CASES)('%s in dark mode %s holds the text and mark bars on its ground', (tone, dark) => {
    const p = noticePalette(tone, dark);

    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(p.subtext, p.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(p.icon, p.bg)).toBeGreaterThanOrEqual(AA_MARK);
  });

  it.each([false, true])('gives each tone its own ground, dark mode %s', (dark) => {
    const grounds = TONES.map((tone) => noticePalette(tone, dark).bg.toLowerCase());

    expect(new Set(grounds).size).toBe(TONES.length);
  });

  it.each([false, true])('draws every tone in the body ink, dark mode %s', (dark) => {
    const neutral = noticePalette('neutral', dark);

    for (const tone of TONES) {
      expect(noticePalette(tone, dark).text).toBe(neutral.text);
    }
  });

  it('edges only the neutral ground, which is the page colour', () => {
    expect(noticePalette('neutral', false).border).toBeDefined();
    expect(noticePalette('error', false).border).toBeUndefined();
  });
});

/** Whether some ancestor of `node` laid out as a row also holds the text `title`. */
function sharesRowWith(node: ReturnType<typeof screen.getByTestId>, title: string): boolean {
  let current = node.parent;
  while (current) {
    const style = StyleSheet.flatten(current.props.style);
    if (
      typeof current.type === 'string' &&
      style?.flexDirection === 'row' &&
      current.findAll((n) => n.props.children === title).length > 0
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

describe('the banner layout', () => {
  afterEach(() => {
    mockFontScale = 1;
  });

  it('draws one action on the title row, not on a row of its own', async () => {
    await render(
      <NoticeBanner
        slot="syncError"
        tone="error"
        icon="alert-circle"
        title="Ferry timetable failed to load"
        actions={[{ label: 'Retry', onPress: jest.fn(), testID: 'ferry-retry' }]}
        testID="ferry-banner"
      />
    );

    expect(sharesRowWith(screen.getByTestId('ferry-retry'), 'Ferry timetable failed to load')).toBe(
      true
    );
  });

  it('closes through an icon button labelled close, on the same row', async () => {
    await render(
      <NoticeBanner
        slot="syncError"
        tone="warning"
        icon="alert"
        title="Two ferries missing"
        onDismiss={jest.fn()}
        testID="ferry-banner"
      />
    );

    const dismiss = screen.getByTestId('ferry-banner-dismiss');
    expect(dismiss.props.accessibilityLabel).toBe('common.close');
    expect(screen.queryByText('common.close')).toBeNull();
    expect(sharesRowWith(dismiss, 'Two ferries missing')).toBe(true);
  });

  it('stacks the controls under the text past the large-text cap', async () => {
    mockFontScale = 2;
    await render(
      <NoticeBanner
        slot="syncError"
        tone="error"
        icon="alert-circle"
        title="Ferry timetable failed to load"
        actions={[{ label: 'Retry', onPress: jest.fn(), testID: 'ferry-retry' }]}
        testID="ferry-banner"
      />
    );

    expect(sharesRowWith(screen.getByTestId('ferry-retry'), 'Ferry timetable failed to load')).toBe(
      false
    );
  });

  it('keeps the title its height once the row stacks past the large-text cap', async () => {
    mockFontScale = 2;
    await render(
      <NoticeBanner
        slot="syncError"
        tone="info"
        icon="information"
        title="Ferry runs on the winter timetable"
        actions={[{ label: 'Details', onPress: jest.fn(), testID: 'ferry-details' }]}
        testID="ferry-banner"
      />
    );

    // A flex child of a column whose height is its content grows from a basis
    // of zero into no spare height, so it lays out at zero and its text is
    // clipped away. Every column between the content and the title has to size
    // that child by its content.
    const content = screen.getByTestId('ferry-banner-content');
    const chain = [];
    for (let node = screen.getByText('Ferry runs on the winter timetable'); node !== content;) {
      if (typeof node.type === 'string') chain.push(node);
      if (!node.parent) throw new Error('the title is not inside the banner content');
      node = node.parent;
    }
    chain.push(content);

    for (let i = 0; i + 1 < chain.length; i++) {
      const direction = StyleSheet.flatten(chain[i + 1].props.style)?.flexDirection ?? 'column';
      if (direction === 'column') {
        expect(StyleSheet.flatten(chain[i].props.style)?.flex ?? 0).toBe(0);
      }
    }
  });

  it('paints the ground from the tone palette', async () => {
    await render(
      <NoticeBanner slot="syncError" tone="info" icon="information" title="Demo" testID="demo-x" />
    );

    expect(StyleSheet.flatten(screen.getByTestId('demo-x').props.style).backgroundColor).toBe(
      noticePalette('info', false).bg
    );
  });
});
