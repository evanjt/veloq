/**
 * Scenario: the tab strip lays its tabs out with `flex: 1` and draws each label
 * in a `Text` with no line limit, so a label wider than its share wraps. On the
 * Insights screen with the debug tab on, five tabs at 1080 wide rendered
 * "Insight" over "s", "Strengt" over "h" and "Section" over "s", with the icons
 * between the halves.
 *
 * Expected behaviour: a label that does not fit is truncated, not broken across
 * two lines mid-word. What the strip should do about not fitting at all, scroll
 * or shorten or drop to icons, is a wider question; a mid-word wrap is wrong
 * under every answer to it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SwipeableTabs } from '@/shared/ui';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const TABS = [
  { key: 'insights', label: 'Insights', icon: 'lightbulb-outline' as const },
  { key: 'strength', label: 'Strength', icon: 'dumbbell' as const },
  { key: 'routes', label: 'Routes', icon: 'map-marker-path' as const },
  { key: 'sections', label: 'Sections', icon: 'road-variant' as const },
  { key: 'debug', label: 'Sync', icon: 'bug-outline' as const },
];

function renderStrip() {
  return render(
    <SwipeableTabs tabs={TABS} activeTab="insights" onTabChange={jest.fn()} isDark={false}>
      {TABS.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
}

describe('the tab strip', () => {
  it.each(TABS.map((t) => t.label))('keeps %s on one line', (label) => {
    const { getByText } = renderStrip();

    expect(getByText(label).props.numberOfLines).toBe(1);
  });

  it('holds every label to one line, however many tabs it is given', () => {
    const { getByText } = renderStrip();

    const wrapping = TABS.filter((t) => getByText(t.label).props.numberOfLines !== 1);

    expect(wrapping.map((t) => t.label)).toStrictEqual([]);
  });
});
