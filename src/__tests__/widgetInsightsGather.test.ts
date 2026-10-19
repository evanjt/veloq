/**
 * Scenario: the app composes the widget snapshot with the list the Insights tab
 * ranks.
 *
 * Expected behaviour: the context handed to the engine lists every kind in the
 * tab's order, because each placed widget filters the kinds for itself, and lists
 * none when the ranking cannot run.
 */

import { gatherWidgetSnapshot } from '@/features/home/lib/widgetSnapshot';
import type { Insight, InsightCategory } from '@/features/insights/light';

const mockEngine = { composeWidgetSnapshot: jest.fn(), setWidgetContext: jest.fn() };

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

const mockCompute = jest.fn();
jest.mock('@/features/insights', () => ({
  fetchInsightsDataFromEngine: () => ({ insightsData: {} }),
  computeInsightsFromData: (...args: unknown[]) => mockCompute(...args),
}));

const insight = (id: string, category: InsightCategory): Insight => ({
  id,
  category,
  priority: 3,
  title: id,
  line: id,
  icon: 'trending-up',
  iconTone: 'info',
  navigationTarget: `/route/${id}`,
  timestamp: 0,
  isNew: false,
});

const t = (key: string) => `t:${key}`;
const opts = { locale: 'en-AU', isMetric: true, translate: t, translateInsight: t };

function composedInsightIds(): string[] {
  const context = mockEngine.composeWidgetSnapshot.mock.calls[0][0];
  return context.insights.map((i: { id: string }) => i.id);
}

beforeEach(() => {
  mockEngine.composeWidgetSnapshot.mockReset().mockReturnValue('{}');
  mockEngine.setWidgetContext.mockReset();
  mockCompute.mockReset().mockReturnValue({
    insights: [insight('a', 'route'), insight('b', 'hrv_trend'), insight('c', 'route')],
    failed: false,
  });
});

describe('the widget snapshot context', () => {
  it('lists the ranked insights of every kind in the tab order', () => {
    gatherWidgetSnapshot(opts);

    expect(composedInsightIds()).toEqual(['a', 'b', 'c']);
  });

  it('words the insights with the translator that interpolates', () => {
    gatherWidgetSnapshot(opts);

    expect(mockCompute).toHaveBeenCalledWith({}, t, true);
  });

  it('lists none without that translator, rather than printing keys', () => {
    gatherWidgetSnapshot({ locale: 'en-AU', isMetric: true, translate: t });

    expect(composedInsightIds()).toEqual([]);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it('still writes the snapshot when the ranking throws', () => {
    mockCompute.mockImplementation(() => {
      throw new Error('pipeline');
    });

    expect(gatherWidgetSnapshot(opts)).not.toBeNull();
    expect(composedInsightIds()).toEqual([]);
  });
});
