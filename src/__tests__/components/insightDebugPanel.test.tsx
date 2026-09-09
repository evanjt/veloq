/**
 * Scenario: the panel listed the pipeline's own output, which is not what the
 * Insights screen shows. Consolidation runs after it, drops on the section
 * story cap and the duplicate-section rule, and reorders what is left, so the
 * only tool for asking "why is that card not there" was blind to the one stage
 * that could answer.
 *
 * Expected behaviour: the panel shows the consolidated list in the order the
 * screen renders it, and names every card consolidation dropped with its
 * reason.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { InsightDebugPanel } from '@/features/insights/components/InsightDebugPanel';
import { getLastInsightOutcome } from '@/features/insights/lib/generateInsights';
import type { PipelineOutcome } from '@/features/insights/lib/generateInsights';
import type { Insight } from '@/types';

jest.mock('@/features/insights/lib/generateInsights', () => ({
  getLastInsightOutcome: jest.fn(),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const mockOutcome = getLastInsightOutcome as jest.MockedFunction<typeof getLastInsightOutcome>;

function insight(id: string, category: Insight['category']): Insight {
  return {
    id,
    category,
    priority: 2,
    title: id,
    icon: 'star',
    iconColor: '#000',
    timestamp: 0,
    isNew: false,
  };
}

function outcome(over: Partial<PipelineOutcome>): PipelineOutcome {
  return {
    kept: [],
    rejected: [],
    scored: [],
    capDropped: [],
    consolidated: null,
    consolidationDropped: [],
    ...over,
  };
}

const rowIds = (testID: string) =>
  screen.queryAllByTestId(testID).map((node) => String(node.props.children));

describe('InsightDebugPanel', () => {
  afterEach(() => mockOutcome.mockReset());

  it('shows the consolidated list in the order the screen renders it', () => {
    const pr = insight('section-pr', 'section_pr');
    const stale = insight('stale-s2', 'stale_pr');
    const fitness = insight('fitness', 'fitness_milestone');
    mockOutcome.mockReturnValue(
      outcome({
        // The pipeline's own order, which is not the order on screen.
        kept: [fitness, pr, stale],
        consolidated: [pr, stale, fitness],
      })
    );

    render(<InsightDebugPanel visible onClose={() => {}} />);

    expect(rowIds('insight-debug-onscreen')).toEqual([
      expect.stringContaining('section_pr/section-pr'),
      expect.stringContaining('stale_pr/stale-s2'),
      expect.stringContaining('fitness_milestone/fitness'),
    ]);
    expect(screen.getByText('On screen (3)')).toBeTruthy();
  });

  it('names every card consolidation dropped, with its reason', () => {
    const pr = insight('section-pr', 'section_pr');
    const dupe = insight('efficiency-s1', 'efficiency_trend');
    mockOutcome.mockReturnValue(
      outcome({
        kept: [pr, dupe],
        consolidated: [pr],
        consolidationDropped: [
          { insight: dupe, reason: 'duplicate section (already covered by PR insight)' },
        ],
      })
    );

    render(<InsightDebugPanel visible onClose={() => {}} />);

    expect(rowIds('insight-debug-onscreen')).toEqual([
      expect.stringContaining('section_pr/section-pr'),
    ]);
    expect(rowIds('insight-debug-consolidated-out')).toEqual([
      expect.stringContaining('efficiency_trend/efficiency-s1'),
    ]);
    expect(screen.getByText(/duplicate section \(already covered by PR insight\)/)).toBeTruthy();
  });

  it('says so when consolidation has not run, rather than passing the pipeline list off as the screen', () => {
    mockOutcome.mockReturnValue(outcome({ kept: [insight('a', 'fitness_milestone')] }));

    render(<InsightDebugPanel visible onClose={() => {}} />);

    expect(screen.getByText('Kept, before consolidation (1)')).toBeTruthy();
    expect(screen.queryByText(/^On screen/)).toBeNull();
  });

  it('renders nothing captured when no pipeline has run', () => {
    mockOutcome.mockReturnValue(null);

    render(<InsightDebugPanel visible onClose={() => {}} />);

    expect(screen.getByText('No pipeline outcome captured yet.')).toBeTruthy();
  });

  it('still lists the gated and cap-dropped candidates', () => {
    const gated = insight('gated', 'fitness_milestone');
    const capped = insight('capped', 'fitness_milestone');
    mockOutcome.mockReturnValue(
      outcome({
        consolidated: [],
        rejected: [{ insight: gated, reason: 'recency_too_old' }],
        capDropped: [{ insight: capped, score: 12, reason: 'surface_cap' }],
      })
    );

    render(<InsightDebugPanel visible onClose={() => {}} />);

    // RNTL collapses runs of whitespace before matching, so the row's double
    // space between the label and the id reads as one here.
    expect(screen.getByText('GATED fitness_milestone/gated - recency_too_old')).toBeTruthy();
    expect(
      screen.getByText('DROPPED fitness_milestone/capped - score=12 (surface_cap)')
    ).toBeTruthy();
  });
});
