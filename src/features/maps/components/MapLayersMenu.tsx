/**
 * The layers control every map shares: a round button that opens a menu of
 * labelled rows. A row is a toggle with its key under the label, so the row and
 * its key are one tap target, and a screen reader hears the layer's name with
 * the key's text as the hint. An action row (fit all) sits below a divider.
 *
 * The button goes in the map's control column; the menu is drawn over the map
 * beside it, with a scrim that closes it.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { RowDivider } from '@/shared/ui/RowGroup';
import { Icon } from '@/shared/ui/Icon';
import { MenuCheck } from '@/shared/ui/ContextMenu';
import { PressTarget } from '@/shared/ui/PressTarget';
import { useBackDismiss } from '@/shared/app/useBackDismiss';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layers,
  layout,
  raised,
  spacing,
  typography,
} from '@/theme';
import { MAP_CONTROL_SIZE, MapControlButton } from './MapControlButton';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One row of the menu: a toggle when `checked` is given, else an action. */
export interface MapLayerRow {
  testID: string;
  icon: IconName;
  label: string;
  checked?: boolean;
  onPress: () => void;
  /** The key drawn under the label. */
  layerKey?: React.ReactNode;
  /** The key's text, read after the label by a screen reader. */
  keyHint?: string | undefined;
}

function MenuRow({ row, isDark }: { row: MapLayerRow; isDark: boolean }) {
  const palette = isDark ? darkColors : colors;
  const { checked } = row;
  const isToggle = checked !== undefined;
  return (
    <PressTarget
      testID={row.testID}
      style={styles.menuRow}
      onPress={row.onPress}
      accessibilityLabel={row.label}
      accessibilityRole={isToggle ? 'checkbox' : 'button'}
      accessibilityState={isToggle ? { checked } : undefined}
      accessibilityHint={row.layerKey ? row.keyHint : undefined}
    >
      <Icon
        name={row.icon}
        size={iconSize.md}
        color={checked ? palette.actionPrimary : palette.textSecondary}
      />
      <View style={styles.menuLabelColumn}>
        <Text style={[styles.menuLabel, { color: palette.textPrimary }]}>{row.label}</Text>
        {row.layerKey}
      </View>
      {isToggle ? <MenuCheck checked={checked} color={palette.actionPrimary} /> : null}
    </PressTarget>
  );
}

/** Whether the menu is open, and how it closes: the button, the scrim and system back. */
export function useLayersMenu(available: boolean) {
  const [requested, setRequested] = useState(false);
  const open = requested && available;
  const close = () => setRequested(false);
  useBackDismiss(open, close);
  return { open, close, toggle: () => setRequested((value) => !value) };
}

export function MapLayersButton({
  testID,
  open,
  onPress,
}: {
  testID: string;
  open: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MapControlButton
      testID={testID}
      selected={open}
      onPress={onPress}
      accessibilityLabel={t('maps.layers')}
      accessibilityState={{ expanded: open }}
    >
      <MapControlButton.Glyph name="layers-outline" />
    </MapControlButton>
  );
}

export function MapLayersMenu({
  testID,
  backdropTestID,
  rows,
  actions = [],
  isDark,
  top,
  right,
  onClose,
}: {
  testID: string;
  backdropTestID: string;
  rows: readonly MapLayerRow[];
  /** Rows below the divider that act rather than toggle. */
  actions?: readonly MapLayerRow[];
  isDark: boolean;
  /** Distance from the map's top to the menu. */
  top: number;
  /** Distance from the map's right edge to the menu. */
  right: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* press-feedback: none, an invisible scrim over the map that only closes the menu */}
      <Pressable
        focusable={false}
        testID={backdropTestID}
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t('common.close')}
        accessibilityRole="button"
      />
      <View
        testID={testID}
        style={[
          styles.menu,
          raised('mapOverlay', isDark),
          isDark && styles.surfaceDark,
          { top, right },
        ]}
      >
        {rows.map((row) => (
          <MenuRow key={row.testID} row={row} isDark={isDark} />
        ))}
        {actions.length > 0 ? (
          <>
            <View style={styles.menuDividerGap}>
              <RowDivider inset="none" />
            </View>
            {actions.map((row) => (
              <MenuRow key={row.testID} row={row} isDark={isDark} />
            ))}
          </>
        ) : null}
      </View>
    </>
  );
}

/** Where a menu sits beside a column button: `buttonsAbove` buttons above it, `edge` from the right. */
export function layersMenuPlacement(top: number, buttonsAbove: number, edge: number) {
  return {
    top: top + buttonsAbove * (MAP_CONTROL_SIZE + spacing.sm),
    right: edge + MAP_CONTROL_SIZE + spacing.sm,
  };
}

const styles = StyleSheet.create({
  surfaceDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  menu: {
    position: 'absolute',
    zIndex: layers.mapOverlay,
    width: layout.mapLayersMenuWidth,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    paddingVertical: spacing.xs,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smPlus,
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  menuLabelColumn: {
    flex: 1,
    gap: spacing.xxs,
  },
  menuLabel: {
    ...typography.bodySmall,
    flexShrink: 1,
  },
  menuDividerGap: {
    paddingVertical: spacing.xs,
  },
});
