import type { Insight } from '@/types';
import { formatDuration } from '@/shared/format/format';

/** Extract the primary metric value + unit from an insight for inline display */
export function getInlineMetric(insight: Insight): { value: string; context?: string } | null {
  const dp = insight.supportingData?.dataPoints;
  const comp = insight.supportingData?.comparisonData;

  switch (insight.category) {
    case 'fitness_milestone': {
      if (dp && dp.length >= 1) {
        const cur = dp[0];
        const change = dp[2];
        return {
          value: `${cur.value}${cur.unit ? ` ${cur.unit}` : ''}`,
          context: change ? String(change.value) : undefined,
        };
      }
      return null;
    }
    case 'hrv_trend': {
      if (dp && dp.length >= 1) {
        return {
          value: `${dp[0].value}${dp[0].unit ? ` ${dp[0].unit}` : ''}`,
        };
      }
      return null;
    }
    case 'period_comparison': {
      if (comp) {
        return {
          value: String(comp.change.value),
        };
      }
      return null;
    }
    case 'strength_progression': {
      if (comp) {
        return {
          value: String(comp.change.value),
        };
      }
      return null;
    }
    case 'strength_balance': {
      const ratioPoint = dp?.find((d) => d.label === 'Ratio');
      if (ratioPoint) {
        return {
          value: String(ratioPoint.value),
        };
      }
      return null;
    }
    case 'section_pr': {
      const sections = insight.supportingData?.sections;
      if (sections && sections.length > 0 && sections[0].bestTime != null) {
        return { value: formatDuration(sections[0].bestTime) };
      }
      return null;
    }
    case 'efficiency_trend': {
      const hrPoint = dp?.find((d) => d.unit === 'bpm');
      if (hrPoint) {
        return { value: `${hrPoint.value} bpm`, context: undefined };
      }
      return null;
    }
    default:
      return null;
  }
}
