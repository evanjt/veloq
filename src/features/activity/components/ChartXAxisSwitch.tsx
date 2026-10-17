import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';
import { ToggleButtonRow } from '@/shared/ui/Button';

export type ChartXAxisMode = 'distance' | 'time';

interface ChartXAxisSwitchProps {
  value: ChartXAxisMode;
  onValueChange: (mode: ChartXAxisMode) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The activity chart's axis choice, Distance or Time, in the chart header.
 * Each option is named by the axis it plots against and carries the selected
 * state, so the control reads as a choice rather than as a value.
 */
export const ChartXAxisSwitch = React.memo(function ChartXAxisSwitch({
  value,
  onValueChange,
  style,
}: ChartXAxisSwitchProps) {
  const { t } = useTranslation();
  return (
    <ToggleButtonRow
      options={[
        { value: 'distance', label: t('activity.xAxis.distance'), testID: 'chart-x-axis-distance' },
        { value: 'time', label: t('activity.xAxis.time'), testID: 'chart-x-axis-time' },
      ]}
      value={value}
      onValueChange={(mode) => {
        if (mode === value) return;
        haptics.selection();
        onValueChange(mode);
      }}
      {...(style !== undefined && { style })}
    />
  );
});
