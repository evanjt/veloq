/**
 * The name and stat rows drawn over a detail map, or on a sheet's surface. The map sheet's cards
 * and their Peek lay these out, so the rows and the text styles they share live here.
 */

import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  colors,
  colorWithOpacity,
  controlHeight,
  darkColors,
  iconSize,
  layout,
  mapTextShadow,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { Icon } from './Icon';
import { PressTarget } from './PressTarget';
import { HeadingControl } from './HeadingControl';
import { useBackDismiss } from '@/shared/app/useBackDismiss';
import { TextField, type TextFieldHandle } from './TextField';
import { NameText } from './NameText';
import { Shimmer, SkeletonLine } from './Shimmer';
import { useTheme } from '@/shared/app/useTheme';

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const noop = () => {};

export const heroTextStyles = StyleSheet.create({
  name: {
    ...typography.statsValue,
    color: colors.textOnFill,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  stat: {
    ...typography.bodyCompactBold,
    color: colors.textOnFill,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  statDivider: {
    ...typography.bodyCompact,
    color: colorWithOpacity(colors.textOnFill, opacity.disabled),
    marginHorizontal: spacing.xsPlus,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
});

function surfaceText(palette: typeof colors | typeof darkColors) {
  return StyleSheet.create({
    name: { ...typography.statsValue, color: palette.textPrimary },
    stat: { ...typography.bodyCompactBold, color: palette.textPrimary },
    statDivider: {
      ...typography.bodyCompact,
      color: palette.textSecondary,
      marginHorizontal: spacing.xsPlus,
    },
  });
}

const surfaceTextStyles = surfaceText(colors);
const surfaceTextStylesDark = surfaceText(darkColors);

/**
 * The Peek block a map sheet shows at its lowest stop: the name row, the date line and the
 * numbers, at these insets. The activity, route and section cards and the skeleton standing in
 * for them all lay their Peek out on it, so nothing moves when the data lands.
 */
export const heroPeekStyles = StyleSheet.create({
  peek: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  dateLine: {
    ...typography.bodyCompact,
  },
});

/** The side of the sport chip before a hero's name. */
const TYPE_ICON_SIZE = 28;

export interface HeroNameRowProps {
  name: string;
  nameTestID?: string;
  /** Sport-type icon chip shown before the name. */
  icon?: { name: MaterialIconName; color: string };
  /** When provided, the name is tap-to-edit with save/cancel controls. */
  editable?: {
    isEditing: boolean;
    editName: string;
    /** Why the typed name was refused, shown under the field while it stays open. */
    error?: string | null;
    inputRef: React.RefObject<TextFieldHandle | null>;
    /** What is being named, shown above the field and read as its name. */
    label: string;
    testIDPrefix: string;
    onStartEdit: () => void;
    onSave: () => void;
    onCancel: () => void;
    onChange: (text: string) => void;
  };
  /** A control drawn beside the name while it is not being edited. */
  accessory?: React.ReactNode;
  /** Drawn on a sheet's surface in the theme's text, rather than over the map in white. */
  onSurface?: boolean;
}

/** The text styles of a name or stats row: over the map, or on a sheet's surface in the theme. */
function useRowText(onSurface: boolean) {
  const { isDark } = useTheme();
  if (!onSurface) {
    return {
      text: {
        name: heroTextStyles.name,
        stat: heroTextStyles.stat,
        statDivider: heroTextStyles.statDivider,
      },
      pencil: colorWithOpacity(colors.textOnFill, 0.6),
    };
  }
  const palette = isDark ? darkColors : colors;
  return {
    text: isDark ? surfaceTextStylesDark : surfaceTextStyles,
    pencil: palette.textSecondary,
  };
}

export function HeroNameRow({
  name,
  nameTestID,
  icon,
  editable,
  accessory,
  onSurface = false,
}: HeroNameRowProps) {
  const { t } = useTranslation();
  const { text, pencil } = useRowText(onSurface);
  // Back cancels the rename, as the cross does, rather than leaving the screen with the name half typed.
  useBackDismiss(!!editable?.isEditing, editable?.onCancel ?? noop);

  return (
    <View style={styles.nameRow}>
      {icon ? (
        <View style={[styles.typeIcon, { backgroundColor: icon.color }]}>
          <Icon name={icon.name} size={iconSize.sm} color={colors.textOnFill} />
        </View>
      ) : null}
      {editable?.isEditing ? (
        <View style={styles.editNameContainer}>
          <TextField
            testID={`${editable.testIDPrefix}-rename-input`}
            ref={editable.inputRef}
            label={editable.label}
            onDarkGround={!onSurface}
            style={styles.editNameField}
            value={editable.editName}
            error={editable.error}
            onChangeText={editable.onChange}
            onSubmitEditing={editable.onSave}
            returnKeyType="done"
            maxLength={255}
            autoFocus
            selectTextOnFocus
          />
          <PressTarget
            testID={`${editable.testIDPrefix}-rename-save`}
            accessibilityRole="button"
            accessibilityLabel={t('common.save')}
            onPress={editable.onSave}
            hitSlop={EDIT_NAME_SLOP}
            style={styles.editNameButton}
          >
            {/* The button sits on a dark scrim over the hero image in both themes, so
                the mark is the light tone rather than the light theme's. */}
            <Icon name="check" size={iconSize.md} color={darkColors.successText} />
          </PressTarget>
          <PressTarget
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={editable.onCancel}
            hitSlop={EDIT_NAME_SLOP}
            style={styles.editNameButton}
          >
            <Icon name="close" size={iconSize.md} color={colors.errorText} />
          </PressTarget>
        </View>
      ) : editable ? (
        // A heading that renames when activated: one role per element, and the name is what the
        // headings rotor needs to land on, so the rename is its hint rather than its role.
        <HeadingControl
          testID={`${editable.testIDPrefix}-rename-button`}
          accessibilityLabel={name}
          accessibilityHint={t('common.rename')}
          onPress={editable.onStartEdit}
          style={styles.nameEditTouchable}
        >
          <NameText testID={nameTestID} style={[text.name, styles.heroName]}>
            {name}
          </NameText>
          <Icon name="pencil" size={iconSize.sm} color={pencil} style={styles.editIcon} />
        </HeadingControl>
      ) : (
        <NameText
          testID={nameTestID}
          accessibilityRole="header"
          style={[text.name, styles.heroName]}
        >
          {name}
        </NameText>
      )}
      {editable?.isEditing ? null : accessory}
    </View>
  );
}

/** One stat on a hero: the text drawn, and the words a screen reader says for it. */
export interface HeroStat {
  text: string;
  /** Names the value, "Distance: 12.3 km", so the strip read as one element says what each is. */
  label: string;
}

export interface HeroStatsRowProps {
  /** Stats rendered with dot dividers; null/undefined entries are skipped. */
  stats: (HeroStat | null | undefined)[];
  testID?: string;
  statTestIDs?: (string | undefined)[];
  style?: StyleProp<ViewStyle>;
  /** Drawn on a sheet's surface in the theme's text, rather than over the map in white. */
  onSurface?: boolean;
}

/**
 * A hero's stat strip, read as one element whose label names each value. The dividers are drawn
 * for the eye and kept out of the accessibility tree.
 */
export function HeroStatsRow({
  stats,
  testID,
  statTestIDs,
  style,
  onSurface = false,
}: HeroStatsRowProps) {
  const { text } = useRowText(onSurface);
  const visible = stats
    .map((stat, index) => (stat ? { ...stat, testID: statTestIDs?.[index] } : null))
    .filter((entry) => entry != null);
  if (visible.length === 0) return null;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={visible.map((entry) => entry.label).join(', ')}
      style={[styles.statsRow, style]}
    >
      {visible.map((entry, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <Text
              style={text.statDivider}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ·
            </Text>
          )}
          <Text testID={entry.testID} style={text.stat}>
            {entry.text}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

/** A name row still to come: a block where the sport chip goes and a bar the name's size. */
export function HeroNameRowSkeleton({
  testID,
  animated = true,
}: {
  testID?: string;
  animated?: boolean;
}) {
  return (
    <View testID={testID} style={styles.nameRow}>
      <Shimmer
        width={TYPE_ICON_SIZE}
        height={TYPE_ICON_SIZE}
        borderRadius={layout.borderRadiusSm}
        animated={animated}
      />
      <SkeletonLine text={typography.statsValue} width="60%" animated={animated} />
    </View>
  );
}

/** The date line still to come, the height of the line it becomes. */
export function HeroDateLineSkeleton({
  testID,
  animated = true,
}: {
  testID?: string;
  animated?: boolean;
}) {
  return (
    <View testID={testID}>
      <SkeletonLine text={heroPeekStyles.dateLine} width="45%" animated={animated} />
    </View>
  );
}

/** A stat strip still to come: one bar a number's size for each stat it will hold. */
export function HeroStatsRowSkeleton({
  count,
  testIDPrefix,
  animated = true,
}: {
  count: number;
  testIDPrefix?: string;
  animated?: boolean;
}) {
  return (
    <View style={[styles.statsRow, styles.statsRowSkeleton]}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} testID={testIDPrefix ? `${testIDPrefix}${index}` : undefined}>
          <SkeletonLine
            text={typography.bodyCompactBold}
            width={STAT_SKELETON_WIDTH}
            animated={animated}
          />
        </View>
      ))}
    </View>
  );
}

/** About the width of one short number on the strip, "12.3 km" or "1:02". */
const STAT_SKELETON_WIDTH = spacing.xxl + spacing.md;

const EDIT_NAME_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);

const styles = StyleSheet.create({
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: TYPE_ICON_SIZE,
    height: TYPE_ICON_SIZE,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroName: {
    flex: 1,
  },
  nameEditTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  editIcon: {
    marginLeft: spacing.xs,
  },
  editNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.scrim,
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  editNameField: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  editNameButton: {
    minWidth: controlHeight.button,
    minHeight: controlHeight.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlayDark.heavy,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xsPlus,
    flexWrap: 'wrap',
  },
  statsRowSkeleton: {
    gap: spacing.md,
  },
});
