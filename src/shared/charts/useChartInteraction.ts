import { useCallback, useState } from 'react';

/**
 * Manages chart crosshair/selection interaction state shared across fitness-style charts.
 *
 * Provides:
 * - `chartInteracting`: whether user is actively dragging (use to disable parent ScrollView)
 * - `selectedDate`: currently pinned crosshair day
 * - `handleInteractionChange` / `handleDateSelect`: stable callbacks suitable for chart props
 *
 * `initialDate` is the day a screen opens already pinned to, which a link from
 * an insight card carries. Selecting it here rather than in an effect keeps the
 * first paint to one render.
 */
export function useChartInteraction(initialDate: string | null = null) {
  const [chartInteracting, setChartInteracting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);

  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  const handleDateSelect = useCallback((date: string | null) => {
    setSelectedDate(date);
  }, []);

  return {
    chartInteracting,
    selectedDate,
    setSelectedDate,
    handleInteractionChange,
    handleDateSelect,
  };
}
