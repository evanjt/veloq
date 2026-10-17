/**
 * Scenario: the explanation card ends with further reading that leaves the app,
 * and its rows key each measure with a dot.
 *
 * Expected behaviour: each reading link is a text link with an external glyph
 * after it, never a button, and opens through the one way out of the app. The
 * Fitness card keys form with the colour the form line is drawn in, not a zone
 * fill.
 */

import React from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { FitnessDefinitionsCard } from '@/features/fitness/components/sections/FitnessDefinitionsCard';
import { FORM_ZONE_COLORS } from '@/features/fitness/lib/fitness';
import { openExternal } from '@/shared/app/openExternal';
import { useChartColors } from '@/shared/charts/useChartColors';
import { Button } from '@/shared/ui/Button';
import { ExplanationCard } from '@/shared/ui/ExplanationCard';
import { spacing } from '@/theme';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/openExternal', () => ({ openExternal: jest.fn() }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => (
      <Text testID={`glyph-${name}`}>{name}</Text>
    ),
  };
});

const LINKS = {
  heading: 'Read more',
  items: [
    { key: 'tides', label: 'Tide tables', url: 'https://tides.example/tables' },
    { key: 'charts', label: 'Harbour charts', url: 'https://charts.example/harbour' },
  ],
};

function FormLineColour({ onColour }: { onColour: (colour: string) => void }) {
  onColour(useChartColors().formLine);
  return null;
}

describe('the explanation card', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('draws each reading link as a text link with an external glyph, and no button', async () => {
    const view = await render(
      <ExplanationCard
        title="How tides work"
        rows={[{ key: 'a', text: 'A line.' }]}
        links={LINKS}
      />
    );

    expect(view.UNSAFE_queryAllByType(Button)).toHaveLength(0);
    const links = view.getAllByRole('link');
    expect(links.map((link) => link.props.accessibilityLabel)).toEqual([
      'Tide tables',
      'Harbour charts',
    ]);
    for (const link of links) {
      const glyphs = link.findAll(
        (node) => node.type === RNText && node.props.testID === 'glyph-open-in-new'
      );
      expect(glyphs).toHaveLength(1);
    }
  });

  it('opens a reading link through the one way out of the app', async () => {
    const view = await render(
      <ExplanationCard
        title="How tides work"
        rows={[{ key: 'a', text: 'A line.' }]}
        links={LINKS}
      />
    );

    fireEvent.press(view.getByRole('link', { name: 'Harbour charts' }));

    expect(openExternal).toHaveBeenCalledWith('https://charts.example/harbour');
  });

  it('keys form on the Fitness card with the form line colour', async () => {
    let formLine = '';
    await render(<FormLineColour onColour={(colour) => (formLine = colour)} />);
    const view = await render(<FitnessDefinitionsCard fitnessDays={42} fatigueDays={7} />);

    const dotColours = view.UNSAFE_root.findAll((node) => String(node.type) === 'View')
      .map((node) => StyleSheet.flatten(node.props.style) ?? {})
      .filter((style) => style.width === spacing.sm && style.height === spacing.sm)
      .map((style) => style.backgroundColor);
    const dotColour = dotColours[dotColours.length - 1];

    expect(dotColours).toHaveLength(3);
    expect(formLine).not.toBe('');
    expect(dotColour).toBe(formLine);
    expect(dotColour).not.toBe(FORM_ZONE_COLORS.optimal);
  });
});
