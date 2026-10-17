/**
 * The action a section row reveals under a swipe, on the sections list and on
 * an activity's Sections tab. Each action has one verb, one glyph and one fill
 * wherever it is offered. Removing a detected section is reversible, so it
 * takes the warning fill and a non-destructive glyph; only deleting a custom
 * section takes the destructive fill and the bin.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LegacyRectButton as RectButton } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import type { TFunction } from 'i18next';

import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import type { AccessibleAction } from '@/shared/ui/accessibleActions';
import { iconSize, spacing, swipeAction, typography } from '@/theme';
import { Icon } from '@/shared/ui/Icon';

export type SectionSwipeKind = 'remove' | 'restore' | 'delete';

const SECTION_SWIPE_ACTIONS = {
  remove: { verb: 'common.remove', glyph: 'minus-circle-outline', fill: swipeAction.hide },
  restore: { verb: 'common.restore', glyph: 'undo', fill: swipeAction.restore },
  delete: { verb: 'common.delete', glyph: 'chrome:delete', fill: swipeAction.destructive },
} as const;

/** Which action a row offers: a custom section is deleted, a detected one removed or restored. */
export function sectionSwipeKind(sectionType: string, isRemoved: boolean): SectionSwipeKind {
  if (sectionType === 'custom') return 'delete';
  return isRemoved ? 'restore' : 'remove';
}

/** The swipe button and the screen reader's action as one, so label and handler cannot drift. */
export function sectionSwipeAction(
  kind: SectionSwipeKind,
  t: TFunction | ((key: string) => string),
  run: () => void
): AccessibleAction {
  return { name: kind, label: String(t(SECTION_SWIPE_ACTIONS[kind].verb)), run };
}

/** The glyph of a section action, the same on a swipe and on the section page's buttons. */
export function SectionActionGlyph({
  kind,
  size,
  color,
}: {
  kind: SectionSwipeKind;
  size: number;
  color: string;
}) {
  const { glyph } = SECTION_SWIPE_ACTIONS[kind];
  return glyph === 'chrome:delete' ? (
    <ChromeIcon name="delete" size={size} color={color} />
  ) : (
    <Icon name={glyph} size={size} color={color} />
  );
}

interface SectionSwipeActionProps {
  kind: SectionSwipeKind;
  action: AccessibleAction;
  /** How far the row has been dragged, negative to the left; the action fades in with it. */
  drag: SharedValue<number>;
}

export function SectionSwipeAction({ kind, action, drag }: SectionSwipeActionProps) {
  const { fill } = SECTION_SWIPE_ACTIONS[kind];
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(drag.value, [-80, -40, 0], [1, 0.8, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View style={[styles.action, { backgroundColor: fill.bg }, fade]}>
      <RectButton style={styles.button} onPress={action.run}>
        <SectionActionGlyph kind={kind} size={iconSize.lg} color={fill.text} />
        <Text style={[styles.label, { color: fill.text }]}>{action.label}</Text>
      </RectButton>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...typography.captionBold,
  },
});
