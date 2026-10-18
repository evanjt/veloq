/**
 * The key to the activity map: a row for every colour the map draws, as
 * `activityKeyRows` lists them. While the line is coloured by gradient that is
 * a row for each of the base map's seven diverging steps with the grades it
 * holds.
 */

import React from 'react';
import { Text } from 'react-native-paper';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, typography, type MapPalette } from '@/theme';
import type { ActivityKeyRow } from './activityMapKey';
import { DivergingKeyRows } from './DivergingKeyRows';
import { MapKey, MapKeySwatch } from './MapKey';

export function ActivityMapKey({
  rows,
  palette,
  isDark,
  top,
}: {
  rows: readonly ActivityKeyRow[];
  /** The base map the key sits over, whose colours the swatches repeat. */
  palette: MapPalette;
  isDark: boolean;
  top: number;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <MapKey isDark={isDark} style={{ top }} testID="activity-map-key">
      {rows.map((row) =>
        row.kind === 'diverging' ? (
          <React.Fragment key={row.id}>
            <Text style={[styles.caption, isDark && styles.captionDark]}>
              {t('chartTypes.grade')}
            </Text>
            <DivergingKeyRows kind={row.diverging} palette={palette} isDark={isDark} />
          </React.Fragment>
        ) : (
          <MapKeySwatch
            key={row.id}
            testID={`activity-map-key-${row.id}`}
            swatch={row.colour}
            label={t(row.labelKey)}
            isDark={isDark}
          />
        )
      )}
    </MapKey>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...typography.label,
    color: colors.textPrimary,
  },
  captionDark: {
    color: darkColors.textPrimary,
  },
});
