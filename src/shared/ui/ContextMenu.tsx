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

import React, { type ComponentProps } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { Menu } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/app';
import { brand, colors, darkColors, layout, spacing, typography } from '@/theme';
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

function isGroup(entry: ContextMenuEntry): entry is ContextMenuGroup {
  return 'items' in entry;
}

/**
 * The tallest the popup draws before it scrolls: the window less its safe-area
 * insets and a margin at each end.
 */
export function contextMenuMaxHeight(windowHeight: number, top: number, bottom: number): number {
  return Math.max(0, windowHeight - top - bottom - 2 * spacing.md);
}

function MenuRow({
  item,
  onDismiss,
  textColor,
  mutedColor,
}: {
  item: ContextMenuAction;
  onDismiss: () => void;
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
        if (!checkable) onDismiss();
        item.onPress();
      }}
      style={pressable(styles.row)}
      android_ripple={pressRipple}
    >
      <MaterialCommunityIcons name={item.icon} size={20} color={mutedColor} />
      <Text style={[styles.rowLabel, { color: textColor }]}>{item.label}</Text>
      {checkable ? (
        <MaterialCommunityIcons
          name="check"
          size={20}
          color={item.checked ? brand.teal : 'transparent'}
        />
      ) : null}
    </Pressable>
  );
}

function AnchoredMenu({ title, entries, visible, onDismiss, children }: ContextMenuProps) {
  const { isDark } = useTheme();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const surface = isDark ? darkColors.surfaceElevated : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Menu
      visible={visible}
      onDismiss={onDismiss}
      anchor={children}
      testID="context-menu"
      contentStyle={[
        styles.surface,
        { backgroundColor: surface, maxWidth: window.width - 2 * spacing.md },
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
            <View key={entry.key} accessibilityRole="menu" accessibilityLabel={entry.label}>
              <Text style={[styles.groupLabel, { color: mutedColor }]}>{entry.label}</Text>
              {entry.items.map((item) => (
                <MenuRow
                  key={item.key}
                  item={item}
                  onDismiss={onDismiss}
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
  const anchored = <AnchoredMenu {...props} />;
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
    borderRadius: layout.borderRadius,
  },
  title: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  groupLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smPlus,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smPlus,
  },
  rowLabel: {
    flexShrink: 1,
    flexGrow: 1,
    fontSize: typography.bodyMedium.fontSize,
  },
});
