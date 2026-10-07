/**
 * Scenario: the lap list and history panel rendered after the content area as
 * siblings, each carrying its own top margin.
 *
 * Expected behaviour: the content area takes them as children and stacks them
 * under the one gap that spaces everything below the chart.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { spacing } from '@/theme';
import { SectionContentArea } from '@/features/routes/components/section/SectionContentArea';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/routes/components/section/SectionPerformanceSection', () => ({
  SectionPerformanceSection: () => null,
}));
jest.mock('@/features/routes/components/section/SectionInfoCard', () => ({
  SectionInfoCard: () => null,
}));
jest.mock('@/features/routes/components/section/SectionEfficiencyCard', () => ({
  SectionEfficiencyCard: () => null,
}));
jest.mock('@/features/routes/components/section/SectionCorrelationCard', () => ({
  SectionCorrelationCard: () => null,
}));

const props = {
  isDark: true,
  mergeCandidates: [],
  isSectionDisabled: false,
  section: { id: 's' },
  combinedChartData: [],
  trendCurves: {},
  calendarSummary: null,
} as unknown as React.ComponentProps<typeof SectionContentArea>;

describe('the section content area stack', () => {
  it('holds its children in the stack that carries the one gap', () => {
    const tree = render(
      <SectionContentArea {...props}>
        <Text testID="tail">tail</Text>
      </SectionContentArea>
    ).toJSON() as { props: { style?: unknown }; children: { props: { testID?: string } }[] };
    expect(tree.children.at(-1)?.props.testID).toBe('tail');
    const stack = StyleSheet.flatten(tree.props.style as never) as Record<string, unknown>;
    expect(stack.gap).toBe(spacing.md);
  });
});
