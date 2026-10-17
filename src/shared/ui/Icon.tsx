/**
 * An icon glyph, drawn from the app's one icon set.
 *
 * The set renders a text holding a private-use character, so a bare glyph is a
 * stop of its own for a screen reader, which reads it as nothing or as the
 * codepoint, and inside a control with no name it becomes part of the name.
 * Here a glyph is decoration unless it is given a label: then it is an image
 * with that name, the one case where the glyph is the only thing saying it.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export type IconProps = Omit<
  React.ComponentProps<typeof MaterialCommunityIcons>,
  | 'accessible'
  | 'accessibilityRole'
  | 'accessibilityElementsHidden'
  | 'importantForAccessibility'
  | 'accessibilityLabel'
> & {
  /** What the glyph says when nothing beside it does; set, the glyph is read as an image. */
  accessibilityLabel?: string | undefined;
};

/** The props that keep an element drawn and out of the screen reader's order. */
export const hiddenFromScreenReader = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

export function Icon({ accessibilityLabel, ...props }: IconProps) {
  if (accessibilityLabel) {
    return (
      <MaterialCommunityIcons
        {...props}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return <MaterialCommunityIcons {...props} {...hiddenFromScreenReader} />;
}
