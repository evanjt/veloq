/**
 * Shared hero header frame for the activity, route, and section detail
 * screens: full-bleed map slot, bottom gradient, floating back button,
 * and a bottom info overlay. HeroNameRow and HeroStatsRow provide the
 * standard overlay content (editable name, dot-separated stats).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, colorWithOpacity, opacity, spacing, typography } from '@/theme';

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const GRADIENT_HEIGHT = 120;

export interface DetailHeroProps {
  height: number;
  insetTop: number;
  onBack: () => void;
  backTestID?: string;
  containerTestID?: string;
  /** Extra buttons on the right of the floating header row. */
  rightActions?: React.ReactNode;
  /** Bottom info overlay content (HeroNameRow / HeroStatsRow or custom). */
  overlay?: React.ReactNode;
  /** The map (or placeholder) filling the hero. */
  children: React.ReactNode;
}

export function DetailHero({
  height,
  insetTop,
  onBack,
  backTestID,
  containerTestID,
  rightActions,
  overlay,
  children,
}: DetailHeroProps) {
  return (
    <View testID={containerTestID} style={[styles.heroSection, { height }]}>
      <View style={styles.mapContainer}>{children}</View>

      <LinearGradient
        colors={['transparent', opacity.overlay.full]}
        style={styles.mapGradient}
        pointerEvents="none"
      />

      <View style={[styles.floatingHeader, { paddingTop: insetTop }]} pointerEvents="box-none">
        <TouchableOpacity
          testID={backTestID}
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <View style={styles.headerSpacer} pointerEvents="none" />
        {rightActions}
      </View>

      {overlay != null && (
        <View style={styles.infoOverlay} pointerEvents="box-none">
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
            autoFocus
            selectTextOnFocus
          />
          <TouchableOpacity
            testID={`${editable.testIDPrefix}-rename-save`}
            onPress={editable.onSave}
            style={styles.editNameButton}
          >
            <MaterialCommunityIcons name="check" size={20} color={colors.success} />
          </TouchableOpacity>
          <TouchableOpacity onPress={editable.onCancel} style={styles.editNameButton}>
            <MaterialCommunityIcons name="close" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      ) : editable ? (
        <TouchableOpacity
          testID={`${editable.testIDPrefix}-rename-button`}
          onPress={editable.onStartEdit}
          style={styles.nameEditTouchable}
          activeOpacity={0.7}
        >
          <Text testID={nameTestID} style={styles.heroName} numberOfLines={1}>
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
        <Text testID={nameTestID} style={styles.heroName} numberOfLines={1}>
          {name}
        </Text>
      )}
    </View>
  );
}

export interface HeroStatsRowProps {
  /** Stat strings rendered with dot dividers; null/undefined entries are skipped. */
  stats: Array<string | null | undefined>;
  testID?: string;
  statTestIDs?: Array<string | undefined>;
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
          {index > 0 && <Text style={styles.statDivider}>·</Text>}
          <Text testID={entry.testID} style={styles.stat}>
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
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: opacity.overlay.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
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
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroName: {
    flex: 1,
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.heavy,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    borderRadius: 8,
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
    padding: 6,
    borderRadius: 6,
    backgroundColor: opacity.overlayDark.heavy,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  stat: {
    fontSize: typography.bodySmall.fontSize,
    color: colorWithOpacity(colors.textOnDark, 0.9),
    textShadowColor: opacity.overlay.heavy,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statDivider: {
    fontSize: typography.bodySmall.fontSize,
    color: colorWithOpacity(colors.textOnDark, 0.5),
    marginHorizontal: spacing.xs,
  },
});
