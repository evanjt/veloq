/**
 * The one menu a hold opens on something in a list. On iOS the hold lifts the
 * source with a preview of where it leads and the system's own menu beside it,
 * which wraps and scrolls at any text size by itself. On Android it is a popup
 * anchored to the source, dismissed by a tap outside it, no wider than the
 * window and scrolling once it is taller than the window.
 *
 * A screen reader reaches the menu through the source's own action rather than
 * a hold, so the anchored popup is drawn on both platforms when `visible` is
 * set: on iOS that is the only way an action can open a menu.
 */

import React, { useEffect, useState, type ComponentProps } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { Menu, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { useWindowInsets } from '@/shared/app/TopSafeAreaContext';
import {
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  MIN_TAP_TARGET,
  shadows,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

type SystemSymbol = NonNullable<ComponentProps<typeof Link.MenuAction>['icon']>;
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export interface ContextMenuAction {
  key: string;
  label: string;
  icon: IconName;
  /** The system symbol iOS draws beside the action. */
  systemIcon: SystemSymbol;
  onPress: () => void;
  /** Set on a checkable item, its state; absent on a plain action. */
  checked?: boolean | undefined;
}

export interface ContextMenuGroup {
  key: string;
  label: string;
  icon: IconName;
  systemIcon: SystemSymbol;
  /** A submenu on iOS, a labelled group in the popup. */
  items: ContextMenuAction[];
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuGroup;

/** A row of the anchored popup, which draws no system symbol and may draw no glyph. */
export type MenuPopupAction = Omit<ContextMenuAction, 'icon' | 'systemIcon'> & {
  icon?: IconName | undefined;
};

export type MenuPopupEntry =
  | MenuPopupAction
  | { key: string; label: string; items: MenuPopupAction[] };

export interface MenuPopupProps {
  /** Names the list, read first. */
  title: string;
  entries: MenuPopupEntry[];
  visible: boolean;
  onDismiss: () => void;
  /** A choice closes the list, for a control whose value the source itself shows. */
  closeOnSelect?: boolean;
  /** What the popup is anchored to. */
  children: React.ReactElement;
}

export interface ContextMenuProps {
  /** Names the menu, the source's own name. */
  title: string;
  /** Where the source leads, shown as the preview on iOS and opened by tapping it. */
  href: Href;
  entries: ContextMenuEntry[];
  /** Opens the anchored popup, which a hold sets on Android and a screen reader on both. */
  visible: boolean;
  onDismiss: () => void;
  /** The source the menu belongs to. */
  children: React.ReactElement;
}

/**
 * Whether the platform opens the menu from a hold by itself. Where it does, the
 * source must not open the popup from its own hold as well.
 */
export function contextMenuHoldIsNative(os: typeof Platform.OS = Platform.OS): boolean {
  return os === 'ios';
}

function isGroup(entry: ContextMenuEntry): entry is ContextMenuGroup;
function isGroup(entry: MenuPopupEntry): entry is Extract<MenuPopupEntry, { items: unknown }>;
function isGroup(entry: ContextMenuEntry | MenuPopupEntry) {
  return 'items' in entry;
}

/**
 * The tallest the popup draws before it scrolls: the window less its safe-area
 * insets and a margin at each end.
 */
export function contextMenuMaxHeight(windowHeight: number, top: number, bottom: number): number {
  return Math.max(0, windowHeight - top - bottom - 2 * spacing.md);
}

/**
 * How long the popup's own close runs, at the paper theme's animation scale of
 * one. A popup mounted closed runs that close once, and when it ends it
 * unmounts the list, undoing any open that came before.
 */
const POPUP_CLOSE_MS = 250;

/** A frame past the close, so the open lands after it rather than beside it. */
const FRAME_MS = 16;

/**
 * Whether the popup may open yet. A popup mounted open may at once; one
 * mounted closed waits out its first close, and an open asked for meanwhile
 * opens when that ends.
 */
function useOpenAllowed(mountedVisible: boolean): boolean {
  const { animation } = usePaperTheme();
  const [allowed, setAllowed] = useState(mountedVisible);
  const wait = POPUP_CLOSE_MS * animation.scale + FRAME_MS;
  useEffect(() => {
    if (allowed) return undefined;
    const timer = setTimeout(() => setAllowed(true), wait);
    return () => clearTimeout(timer);
  }, [allowed, wait]);
  return allowed;
}

/** The widest the popup draws, and never closer than a margin to either edge. */
const MAX_WIDTH = 280;

/**
 * Raised by a shadow in light. A shadow does not read on a near-black ground,
 * so in dark the popup is raised by its own step and an edge instead.
 */
function raisedEdge(isDark: boolean) {
  return isDark
    ? {
        ...shadows.none,
        borderWidth: stroke.hairline,
        borderColor: darkColors.borderLight,
      }
    : shadows.elevated;
}

function MenuRow({
  item,
  onDismiss,
  closeOnSelect,
  textColor,
  mutedColor,
}: {
  item: MenuPopupAction;
  onDismiss: () => void;
  closeOnSelect: boolean;
  textColor: string;
  mutedColor: string;
}) {
  const checkable = item.checked !== undefined;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      accessibilityState={checkable ? { checked: !!item.checked } : undefined}
      onPress={() => {
        // A choice stays open so its new state is seen, an action leaves.
        if (!checkable || closeOnSelect) onDismiss();
        item.onPress();
      }}
      style={pressable(styles.row)}
      android_ripple={pressRipple}
    >
      {item.icon ? (
        <MaterialCommunityIcons name={item.icon} size={iconSize.md} color={mutedColor} />
      ) : null}
      <Text style={[styles.rowLabel, { color: textColor }]}>{item.label}</Text>
      {checkable ? (
        <MaterialCommunityIcons
          name="check"
          size={iconSize.md}
          color={item.checked ? brand.blue550 : 'transparent'}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * The anchored popup on its own: the list a hold opens on Android, and the list
 * a control opens from a tap on both platforms.
 */
export function MenuPopup({
  title,
  entries,
  visible,
  onDismiss,
  closeOnSelect = false,
  children,
}: MenuPopupProps) {
  const { isDark } = useTheme();
  const window = useWindowDimensions();
  const insets = useWindowInsets();
  const surface = isDark ? darkColors.surfaceElevated : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const hairline = isDark ? darkColors.divider : colors.divider;
  const openAllowed = useOpenAllowed(visible);

  return (
    <Menu
      visible={openAllowed ? visible : false}
      onDismiss={onDismiss}
      anchor={children}
      testID="context-menu"
      mode="flat"
      contentStyle={[
        styles.surface,
        raisedEdge(isDark),
        {
          backgroundColor: surface,
          maxWidth: Math.min(MAX_WIDTH, window.width - 2 * spacing.md),
        },
      ]}
    >
      <ScrollView
        testID="context-menu-scroll"
        style={{ maxHeight: contextMenuMaxHeight(window.height, insets.top, insets.bottom) }}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: mutedColor }]}>
          {title}
        </Text>
        {entries.map((entry) =>
          isGroup(entry) ? (
            <View
              key={entry.key}
              accessibilityRole="menu"
              accessibilityLabel={entry.label}
              style={[styles.group, { borderTopColor: hairline }]}
            >
              <Text style={[styles.groupLabel, { color: mutedColor }]}>{entry.label}</Text>
              {entry.items.map((item) => (
                <MenuRow
                  key={item.key}
                  item={item}
                  onDismiss={onDismiss}
                  closeOnSelect={closeOnSelect}
                  textColor={textColor}
                  mutedColor={mutedColor}
                />
              ))}
            </View>
          ) : (
            <MenuRow
              key={entry.key}
              item={entry}
              onDismiss={onDismiss}
              closeOnSelect={closeOnSelect}
              textColor={textColor}
              mutedColor={mutedColor}
            />
          )
        )}
      </ScrollView>
    </Menu>
  );
}

function nativeAction(item: ContextMenuAction) {
  return (
    <Link.MenuAction
      key={item.key}
      icon={item.systemIcon}
      {...(item.checked !== undefined && { isOn: item.checked })}
      onPress={item.onPress}
    >
      {item.label}
    </Link.MenuAction>
  );
}

// The link hands its press and role to the trigger's child. The source keeps
// its own, so this takes them and draws only the source.
function TriggerSource({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function ContextMenu(props: ContextMenuProps) {
  const { href: _href, ...popup } = props;
  const anchored = <MenuPopup {...popup} />;
  if (!contextMenuHoldIsNative()) return anchored;

  return (
    <Link href={props.href} asChild>
      <Link.Trigger>
        <TriggerSource>{anchored}</TriggerSource>
      </Link.Trigger>
      <Link.Preview />
      <Link.Menu title={props.title}>
        {props.entries.map((entry) =>
          isGroup(entry) ? (
            <Link.Menu key={entry.key} title={entry.label} icon={entry.systemIcon}>
              {entry.items.map(nativeAction)}
            </Link.Menu>
          ) : (
            nativeAction(entry)
          )
        )}
      </Link.Menu>
    </Link>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: layout.borderRadiusMd,
  },
  title: {
    ...typography.captionBold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  group: {
    borderTopWidth: stroke.hairline,
  },
  groupLabel: {
    ...typography.sectionHeader,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smPlus,
    // The Android target on both platforms: the popup is the same list there.
    minHeight: MIN_TAP_TARGET.android,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smPlus,
  },
  rowLabel: {
    flexShrink: 1,
    flexGrow: 1,
    ...typography.bodyMedium,
  },
});
