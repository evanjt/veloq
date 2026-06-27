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
 */
export function useChartInteraction() {
  const [chartInteracting, setChartInteracting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
