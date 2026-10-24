import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize } from '@/theme';
import { type CircleOption, CircleOptionRow } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import type { Terrain3DMode } from '@/types';

/** Smaller than the map style circles above it: a setting of the map, not a picture of one. */
const CIRCLE_SIZE = 52;

const MODES: {
  mode: Terrain3DMode;
  labelKey: string;
  icon: 'map-outline' | 'image-filter-hdr-outline' | 'image-filter-hdr';
}[] = [
  { mode: 'off', labelKey: 'settings.terrain3DOff', icon: 'map-outline' },
  { mode: 'smart', labelKey: 'settings.terrain3DSmart', icon: 'image-filter-hdr-outline' },
  { mode: 'always', labelKey: 'settings.terrain3DAlways', icon: 'image-filter-hdr' },
];

interface Terrain3DPickerProps {
  value: Terrain3DMode;
  onValueChange: (mode: Terrain3DMode) => void;
}

/** The 3D terrain mode, drawn as circles to match the map style picker. */
export function Terrain3DPicker({ value, onValueChange }: Terrain3DPickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  const options: CircleOption<Terrain3DMode>[] = MODES.map(({ mode, labelKey, icon }) => ({
    value: mode,
    testID: `terrain-3d-${mode}`,
    label: t(labelKey as never) as string,
    render: () => (
      <Icon
        name={icon}
        size={iconSize.lg}
        color={mode === value ? palette.actionPrimary : palette.textSecondary}
      />
    ),
  }));

  return (
    <CircleOptionRow
      options={options}
      value={value}
      onValueChange={onValueChange}
      maxSize={CIRCLE_SIZE}
      testID="terrain-3d-picker"
    />
  );
}
