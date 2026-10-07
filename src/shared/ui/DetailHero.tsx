/**
 * Shared hero frame for the activity, route, and section detail screens:
 * full-bleed map slot, bottom gradient and a bottom info overlay. The back
 * control is the stack's transparent native header, drawn over the map. HeroNameRow and HeroStatsRow provide the
 * standard overlay content (editable name, dot-separated stats).
 */

import React from 'react';
import { Pressable, View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import {
  colors,
  colorWithOpacity,
  opacity,
  spacing,
  typography,
  layout,
  darkColors,
  mapTextShadow,
} from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const GRADIENT_HEIGHT = 120;
const NATIVE_BACK_CONTROL_SIZE = 40;

export const heroTextStyles = StyleSheet.create({
  name: {
    ...typography.statsValue,
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  stat: {
    ...typography.bodyCompact,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  statDivider: {
    ...typography.bodyCompact,
    color: colorWithOpacity(colors.textOnDark, 0.5),
    marginHorizontal: spacing.xsPlus,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
});

/**
 * Height of the native header's control row below the top inset. Anything a
 * hero's map floats over its own top corners has to clear the inset plus this,
 * or it lands under the back control.
 */
export const HERO_HEADER_HEIGHT = NATIVE_BACK_CONTROL_SIZE + spacing.sm;

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
  return (
    <View testID={containerTestID} style={[styles.heroSection, { height }]}>
      <View style={styles.mapContainer}>{children}</View>

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
    inputRef: React.RefObject<TextInput | null>;
    placeholder: string;
    testIDPrefix: string;
    onStartEdit: () => void;
    onSave: () => void;
    onCancel: () => void;
    onChange: (text: string) => void;
  };
}

export function HeroNameRow({ name, nameTestID, icon, editable }: HeroNameRowProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.nameRow}>
      {icon && (
        <View style={[styles.typeIcon, { backgroundColor: icon.color }]}>
          <MaterialCommunityIcons name={icon.name} size={16} color={colors.textOnDark} />
        </View>
      )}
      {editable?.isEditing ? (
        <View style={styles.editNameContainer}>
          <TextInput
            testID={`${editable.testIDPrefix}-rename-input`}
            ref={editable.inputRef}
            style={styles.editNameInput}
            value={editable.editName}
            onChangeText={editable.onChange}
            onSubmitEditing={editable.onSave}
            placeholder={editable.placeholder}
            placeholderTextColor={colorWithOpacity(colors.textOnDark, 0.5)}
            returnKeyType="done"
            maxLength={255}
            autoFocus
            selectTextOnFocus
          />
          <Pressable
            testID={`${editable.testIDPrefix}-rename-save`}
            accessibilityRole="button"
            accessibilityLabel={t('common.save')}
            onPress={editable.onSave}
            style={pressable(styles.editNameButton)}
            android_ripple={pressRipple}
          >
            {/* The button sits on a dark scrim over the hero image in both themes, so
                the mark is the light tone rather than the light theme's. */}
            <MaterialCommunityIcons name="check" size={20} color={darkColors.successDeep} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={editable.onCancel}
            style={pressable(styles.editNameButton)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.error} />
          </Pressable>
        </View>
      ) : editable ? (
        <TouchableOpacity
          testID={`${editable.testIDPrefix}-rename-button`}
          accessibilityRole="button"
          accessibilityLabel={t('common.rename')}
          onPress={editable.onStartEdit}
          style={styles.nameEditTouchable}
          activeOpacity={0.7}
        >
          <Text
            testID={nameTestID}
            style={[heroTextStyles.name, styles.heroName]}
            numberOfLines={1}
          >
            {name}
          </Text>
          <MaterialCommunityIcons
            name="pencil"
            size={14}
            color={colorWithOpacity(colors.textOnDark, 0.6)}
            style={styles.editIcon}
          />
        </TouchableOpacity>
      ) : (
        <Text testID={nameTestID} style={[heroTextStyles.name, styles.heroName]} numberOfLines={1}>
          {name}
        </Text>
      )}
    </View>
  );
}

export interface HeroStatsRowProps {
  /** Stat strings rendered with dot dividers; null/undefined entries are skipped. */
  stats: (string | null | undefined)[];
  testID?: string;
  statTestIDs?: (string | undefined)[];
}

export function HeroStatsRow({ stats, testID, statTestIDs }: HeroStatsRowProps) {
  const visible = stats
    .map((value, index) => ({ value, testID: statTestIDs?.[index] }))
    .filter((entry): entry is { value: string; testID: string | undefined } => entry.value != null);
  if (visible.length === 0) return null;

  return (
    <View testID={testID} style={styles.statsRow}>
      {visible.map((entry, index) => (
        <React.Fragment key={index}>
          {index > 0 && <Text style={heroTextStyles.statDivider}>·</Text>}
          <Text testID={entry.testID} style={heroTextStyles.stat}>
            {entry.value}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

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
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: GRADIENT_HEIGHT,
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    zIndex: 5,
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
  editNameInput: {
    flex: 1,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    paddingVertical: spacing.sm,
  },
  editNameButton: {
    minWidth: layout.minTapTarget,
    minHeight: layout.minTapTarget,
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
