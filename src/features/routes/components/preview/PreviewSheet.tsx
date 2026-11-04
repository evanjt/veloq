/**
 * The bottom sheet the preview screens lay over a full-bleed map.
 *
 * Collapsed it shows only `summary`, the few lines a decision needs. Dragged or
 * tapped up it also shows `children`, the controls that edit the run. The
 * children stay mounted while collapsed, so a slider keeps its value and its
 * place, and are hidden rather than torn down.
 */

import React, { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { MapSheetToggleHandle } from '@/shared/ui';
import { colors, darkColors, layout, raised, spacing, stroke } from '@/theme';

/** How far the handle must travel before a drag counts as a swipe, in dp. */
const SWIPE_DISTANCE = 24;

/** The share of the window the expanded sheet takes. */
export const SHEET_EXPANDED_SHARE = 0.55;

interface PreviewSheetProps {
  /** Always shown: the diff summary, the run state and the decision. */
  summary: React.ReactNode;
  /** Shown while expanded: the controls that edit the run. */
  children: React.ReactNode;
  /** Bottom padding, so the last row clears the tab bar and the home indicator. */
  bottomInset: number;
  /** The handle's accessibility label; the section preview's by default. */
  handleLabel?: string;
  testID?: string;
}

export function PreviewSheet({
  summary,
  children,
  bottomInset,
  handleLabel,
  testID,
}: PreviewSheetProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > SWIPE_DISTANCE / 2,
        onPanResponderRelease: (_, g) => {
          if (g.dy <= -SWIPE_DISTANCE) setExpanded(true);
          else if (g.dy >= SWIPE_DISTANCE) setExpanded(false);
        },
      }),
    []
  );

  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <View
      style={[
        styles.sheet,
        raised('elevated', isDark),
        { backgroundColor: surface, borderColor: border, paddingBottom: bottomInset },
      ]}
      testID={testID}
    >
      <View {...swipe.panHandlers}>
        <MapSheetToggleHandle
          expanded={expanded}
          onChange={setExpanded}
          label={handleLabel ?? t('settings.previewSections')}
          testID={testID ? `${testID}-handle` : undefined}
        />
      </View>
      <View style={styles.summary}>{summary}</View>
      {/* A fixed height, so the slider card inside fills it and is the only thing that scrolls. */}
      <View
        style={
          expanded ? [styles.body, { height: windowHeight * SHEET_EXPANDED_SHARE }] : styles.hidden
        }
        testID={testID ? `${testID}-body` : undefined}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: layout.borderRadiusXl,
    borderTopRightRadius: layout.borderRadiusXl,
    borderWidth: stroke.hairline,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.md,
  },
  summary: {
    gap: spacing.sm,
  },
  hidden: {
    display: 'none',
  },
  body: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
});
