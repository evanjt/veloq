import { useCallback, useState } from 'react';

interface FitnessChartValues {
  fitness: number;
  fatigue: number;
  form: number;
}

/**
 * Manages chart crosshair/selection interaction state shared across fitness-style charts.
 *
 * Provides:
 * - `chartInteracting`: whether user is actively dragging (use to disable parent ScrollView)
 * - `selectedDate` / `selectedValues`: currently pinned crosshair selection
 * - `handleInteractionChange` / `handleDateSelect`: stable callbacks suitable for chart props
 *
 * `initialDate` is the day a screen opens already pinned to, which a link from
 * an insight card carries. Selecting it here rather than in an effect keeps the
 * first paint to one render.
 */
export function useChartInteraction(initialDate: string | null = null) {
  const [chartInteracting, setChartInteracting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  const [selectedValues, setSelectedValues] = useState<FitnessChartValues | null>(null);

  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  const handleDateSelect = useCallback((date: string | null, values: FitnessChartValues | null) => {
    setSelectedDate(date);
    setSelectedValues(values);
  }, []);

  return {
    chartInteracting,
    selectedDate,
    selectedValues,
    setSelectedDate,
    setSelectedValues,
    handleInteractionChange,
    handleDateSelect,
  };
}
