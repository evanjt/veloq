/**
 * A sheet's title row, and where its Cancel and its confirming action sit.
 *
 * Sheets follow the platform, so the two actions sit in a different place on
 * each. On iOS an editing sheet carries them in its top bar: Cancel on the
 * leading edge, the confirm on the trailing edge in bold, the title between.
 * On Android a Material bottom sheet keeps its title row bare and ends on a
 * row of a ghost Cancel and the primary confirm. It has no close control of
 * its own: drag, the scrim and system back dismiss it, so an Android sheet
 * with nothing to confirm shows no Cancel either.
 *
 * A sheet with nothing to choose or confirm, one that only shows something,
 * passes `onClose` instead of `onCancel`. On iOS that is a close icon on the
 * trailing edge of the title row, since a swipe or a tap outside the sheet is
 * a gesture with nothing on screen to show it and at the full detent there is
 * no outside to tap. On Android it draws nothing, for the reason above.
 *
 * In the iOS top bar the title holds one line, centred, and the actions keep
 * their full width, so a long title truncates before a label wraps. A subtitle
 * leaves the bar and runs the full width under it, as a top bar carries only
 * a title.
 *
 * `SheetHeader` goes above the content and `SheetActions` below it, both given
 * the same `onCancel` and `confirm`. On each platform exactly one of them
 * draws the actions, so a sheet route never decides the placement itself.
 */

import React, { useState } from 'react';
import {
  Platform,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  colors,
  controlHeight,
  darkColors,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';

import { Button, paint } from './Button';
import { IconButton } from './IconButton';
import { pressable, pressRipple } from './pressFeedback';

export interface SheetConfirm {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}

export interface SheetActionsProps {
  /** Leaves the sheet with nothing chosen. The label is always the shared Cancel. */
  onCancel?: (() => void) | undefined;
  cancelTestID?: string | undefined;
  /** The action that commits the sheet, emphasised on both platforms. */
  confirm?: SheetConfirm | undefined;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
}

export interface SheetHeaderProps extends SheetActionsProps {
  title: string;
  /** A line under the title saying what the sheet is for. */
  subtitle?: string | undefined;
  /** A mark drawn before the title, such as an insight's tone icon. */
  leading?: React.ReactNode;
  /** Dismisses a sheet that only shows something. A sheet passes this or `onCancel`, never both. */
  onClose?: (() => void) | undefined;
  closeTestID?: string | undefined;
  /** The title's own id, where a flow names it. Otherwise it is `testID` with `-title`. */
  titleTestID?: string | undefined;
}

/** The close glyph, the same in every sheet. */
const CLOSE_GLYPH = 22;

/** Whether this platform carries a sheet's actions in its title row rather than below it. */
function actionsInTitleRow(): boolean {
  return Platform.OS !== 'android';
}

export function SheetHeader({
  title,
  subtitle,
  leading,
  onCancel,
  cancelTestID,
  confirm,
  onClose,
  closeTestID,
  titleTestID,
  style,
  testID,
}: SheetHeaderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [slots, setSlots] = useState({ leading: 0, trailing: 0 });
  const inRow =
    actionsInTitleRow() &&
    (onCancel !== undefined || confirm !== undefined || onClose !== undefined);

  const titleText = (
    <Text
      testID={titleTestID ?? (testID && `${testID}-title`)}
      accessibilityRole="header"
      numberOfLines={inRow ? 1 : undefined}
      style={[styles.title, inRow && styles.barTitle, { color: palette.textPrimary }]}
    >
      {title}
    </Text>
  );
  const subtitleText = subtitle ? (
    <Text
      testID={testID ? `${testID}-subtitle` : undefined}
      style={[styles.subtitle, { color: palette.textSecondary }]}
    >
      {subtitle}
    </Text>
  ) : null;

  if (!inRow) {
    return (
      <View testID={testID} style={[styles.row, style]}>
        <View style={styles.heading}>
          {leading}
          <View style={styles.headingText}>
            {titleText}
            {subtitleText}
          </View>
        </View>
      </View>
    );
  }

  // The slots keep their content's width, so the title is centred by
  // giving the narrower slot's side the difference.
  const measure = (slot: 'leading' | 'trailing') => (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSlots((prev) => (prev[slot] === width ? prev : { ...prev, [slot]: width }));
  };
  const side = Math.max(slots.leading, slots.trailing);

  return (
    <View testID={testID} style={[styles.bar, style]}>
      <View style={styles.barRow}>
        <View style={styles.slot} onLayout={measure('leading')}>
          {onCancel ? (
            <BarButton label={t('common.cancel')} onPress={onCancel} testID={cancelTestID} />
          ) : null}
        </View>
        <View
          style={[
            styles.heading,
            styles.barHeading,
            { marginStart: side - slots.leading, marginEnd: side - slots.trailing },
          ]}
        >
          {leading}
          <View style={styles.headingText}>{titleText}</View>
        </View>
        <View style={styles.slot} onLayout={measure('trailing')}>
          {confirm ? (
            <BarButton
              label={confirm.label}
              onPress={confirm.onPress}
              disabled={confirm.disabled}
              testID={confirm.testID}
              bold
            />
          ) : null}
          {onClose ? (
            <IconButton
              testID={closeTestID}
              onPress={onClose}
              accessibilityLabel={t('common.close')}
            >
              <MaterialCommunityIcons
                name="close"
                size={CLOSE_GLYPH}
                color={palette.textSecondary}
              />
            </IconButton>
          ) : null}
        </View>
      </View>
      {subtitleText}
    </View>
  );
}

/** The bottom row of a sheet's actions, drawn on Android only and only when there is a confirm. */
export function SheetActions({
  onCancel,
  cancelTestID,
  confirm,
  style,
  testID,
}: SheetActionsProps) {
  const { t } = useTranslation();
  if (actionsInTitleRow() || !confirm) return null;

  return (
    <View testID={testID} style={[styles.actions, style]}>
      {onCancel ? (
        <Button
          {...(cancelTestID !== undefined && { testID: cancelTestID })}
          label={t('common.cancel')}
          onPress={onCancel}
          variant="ghost"
        />
      ) : null}
      <Button
        {...(confirm.testID !== undefined && { testID: confirm.testID })}
        label={confirm.label}
        onPress={confirm.onPress}
        disabled={confirm.disabled ?? false}
      />
    </View>
  );
}

interface BarButtonProps {
  label: string;
  onPress: () => void;
  bold?: boolean;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}

/** A text action in an iOS sheet's top bar: the tint colour, the confirm in bold. */
function BarButton({ label, onPress, bold = false, disabled = false, testID }: BarButtonProps) {
  const { isDark } = useTheme();
  const tint = paint('ghost', isDark).color;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={BAR_SLOP}
      disabled={disabled}
      onPress={onPress}
      android_ripple={pressRipple}
      style={pressable([styles.barButton, disabled && styles.inert])}
    >
      <Text
        testID={testID ? `${testID}-label` : undefined}
        style={[bold ? styles.barLabelBold : styles.barLabel, { color: tint }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const BAR_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  heading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bar: {
    gap: spacing.xxs,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  // Between the two slots the heading takes what they leave and centres in it.
  barHeading: {
    justifyContent: 'center',
  },
  headingText: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  title: typography.cardTitle,
  subtitle: typography.bodySmall,
  // Between two actions the title centres, as the system top bar draws it.
  barTitle: {
    textAlign: 'center',
  },
  // An action never narrows below its label; the title gives way instead.
  slot: {
    flexShrink: 0,
  },
  barButton: {
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: controlHeight.button,
    minWidth: controlHeight.button,
  },
  inert: {
    opacity: 0.5,
  },
  barLabel: typography.body,
  barLabelBold: typography.bodyBold,
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
});
