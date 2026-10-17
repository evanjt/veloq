/**
 * Shared hero frame for the activity, route, and section detail screens:
 * full-bleed map slot, a top scrim, a bottom gradient and a bottom info
 * overlay. The back control is the stack's transparent native header, drawn
 * over the map. HeroNameRow and HeroStatsRow provide the standard overlay
 * content (editable name, dot-separated stats).
 */

import React from 'react';
import { Platform, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import {
  colors,
  colorWithOpacity,
  controlHeight,
  darkColors,
  iconSize,
  layers,
  layout,
  mapTextShadow,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { Icon } from './Icon';
import { BACK_SWIPE_EDGE_WIDTH } from './backSwipeEdge';
import { PressTarget } from './PressTarget';
import { useBackDismiss } from '@/shared/app/useBackDismiss';
import { TextField, type TextFieldHandle } from './TextField';
import { useHeroHeaderBottom } from './useHeroHeaderBottom';
import { NameText } from './NameText';

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The band at the hero's bottom that the gradient darkens and the info overlay sits in. */
export const HERO_GRADIENT_HEIGHT = 120;
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

/** How far below the header the top scrim takes to fade out. */
const TOP_SCRIM_FADE = spacing.xl;

/**
 * Held across the status bar and the header row, so the white back control and
 * status glyphs keep 3:1 over the palest tile. A pure white tile under black at
 * 0.5 composites to a grey white reads at about 4:1 against.
 */
const TOP_SCRIM_COLOUR = opacity.overlay.heavy;

export interface DetailHeroProps {
  height: number;
  containerTestID?: string;
  /** Bottom info overlay content (HeroNameRow / HeroStatsRow or custom). */
  overlay?: React.ReactNode;
  /**
   * Extra bottom padding for the info overlay, so it clears a map attribution
   * pill drawn in the same corner. Pass ATTRIBUTION_CLEARANCE when the hero's
   * map shows attribution.
   */
  attributionClearance?: number;
  /** Right padding for the info overlay, so its text stays clear of controls drawn down the map's edge. */
  overlayInsetEnd?: number;
  /** The map (or placeholder) filling the hero. */
  children: React.ReactNode;
}

export function DetailHero({
  height,
  containerTestID,
  overlay,
  attributionClearance = 0,
  overlayInsetEnd,
  children,
}: DetailHeroProps) {
  const headerBottom = useHeroHeaderBottom();
  const topScrimHeight = headerBottom + TOP_SCRIM_FADE;

  return (
    <View testID={containerTestID} style={[styles.heroSection, { height }]}>
      <View style={styles.mapContainer}>{children}</View>

      {/* The leading edge belongs to the stack's back swipe on iOS. A touch that lands here hits a
          plain view, so the map's pan never sees it and the ancestor's pop recogniser does. Android
          has no edge swipe to give back, and a strip there would only take pan from the map. */}
      {Platform.OS === 'ios' && (
        <View testID="detail-hero-back-edge" accessible={false} style={styles.backSwipeEdge} />
      )}

      <LinearGradient
        testID="detail-hero-top-scrim"
        colors={[TOP_SCRIM_COLOUR, TOP_SCRIM_COLOUR, 'transparent']}
        locations={[0, headerBottom / topScrimHeight, 1]}
        style={[styles.topScrim, { height: topScrimHeight }]}
        pointerEvents="none"
      />

      <LinearGradient
        testID="detail-hero-gradient"
        colors={['transparent', opacity.overlay.full]}
        style={styles.mapGradient}
        pointerEvents="none"
      />

      {overlay != null && (
        <View
          testID="detail-hero-overlay"
          style={[
            styles.infoOverlay,
            { paddingBottom: spacing.md + attributionClearance },
            overlayInsetEnd != null && { paddingRight: overlayInsetEnd },
          ]}
          pointerEvents="box-none"
        >
          {overlay}
        </View>
      )}
    </View>
  );
}

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
}

export function HeroNameRow({ name, nameTestID, icon, editable, accessory }: HeroNameRowProps) {
  const { t } = useTranslation();
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
            onDarkGround
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
        <PressTarget
          testID={`${editable.testIDPrefix}-rename-button`}
          accessibilityRole="header"
          accessibilityLabel={name}
          accessibilityHint={t('common.rename')}
          onPress={editable.onStartEdit}
          style={styles.nameEditTouchable}
        >
          <NameText testID={nameTestID} style={[heroTextStyles.name, styles.heroName]}>
            {name}
          </NameText>
          <Icon
            name="pencil"
            size={iconSize.sm}
            color={colorWithOpacity(colors.textOnFill, 0.6)}
            style={styles.editIcon}
          />
        </PressTarget>
      ) : (
        <NameText
          testID={nameTestID}
          accessibilityRole="header"
          style={[heroTextStyles.name, styles.heroName]}
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
}

/**
 * A hero's stat strip, read as one element whose label names each value. The dividers are drawn
 * for the eye and kept out of the accessibility tree.
 */
export function HeroStatsRow({ stats, testID, statTestIDs, style }: HeroStatsRowProps) {
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
              style={heroTextStyles.statDivider}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ·
            </Text>
          )}
          <Text testID={entry.testID} style={heroTextStyles.stat}>
            {entry.text}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

const EDIT_NAME_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);

const styles = StyleSheet.create({
  heroSection: {
    position: 'relative',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backSwipeEdge: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
    width: BACK_SWIPE_EDGE_WIDTH,
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: HERO_GRADIENT_HEIGHT,
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    zIndex: layers.raised,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: 28,
    height: 28,
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
});
