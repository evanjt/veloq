/**
 * The root of a sheet route whose body scrolls. It paints nothing: the sheet frame around it is
 * the sheet's one fill.
 *
 * The iOS form sheet sizes a scroll view that is the first view of its content. It also follows
 * the first child of each view down from the content, and a scroll view met deeper on that path
 * gets the sheet's own frame as its frame, in the coordinates of the view around it, which moves
 * it out of sight and leaves the sheet blank. So the scroll view is the root, and nothing wraps
 * it.
 *
 * `footer` draws below the scroll view rather than inside it, so a sheet's actions stay in view at
 * any detent while only the body scrolls. It is a sibling in a fragment, not a wrapper, so the
 * scroll view is still the first view of the content.
 *
 * Where the shared sheet frame draws no view, on iOS, the scroll view paints the frame's fill and
 * ends its content, or its footer, clear of the home indicator by the frame's padding.
 *
 * Android's form sheet hands a drag to its content only through the first view, depth first,
 * that scrolls nested. With none it takes every drag it can follow, so a body scrolled down never
 * scrolls back up: each drag down moves the sheet. A sheet's scroll view therefore scrolls nested,
 * and a list that cannot be this view spreads `sheetScrollProps` for the same hand-off.
 */

import React, { forwardRef, useContext } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ScrollViewInstance,
} from 'react-native';

import { SheetFrameContext } from './sheetFrameContext';

/** The props that hand a sheet's drags to a scrolling body. iOS ignores them. */
export const sheetScrollProps = { nestedScrollEnabled: true } as const;

type SheetScrollViewProps = Omit<ScrollViewProps, 'style'> & {
  footer?: React.ReactNode;
};

export const SheetScrollView = forwardRef<ScrollViewInstance, SheetScrollViewProps>(
  function SheetScrollView({ footer, children, ...props }, ref) {
    const frame = useContext(SheetFrameContext);
    const fill = frame?.backgroundColor ? { backgroundColor: frame.backgroundColor } : null;
    const inset = frame && frame.paddingBottom > 0 ? { paddingBottom: frame.paddingBottom } : null;
    const scroll = (
      <ScrollView ref={ref} style={[styles.sheet, fill]} {...sheetScrollProps} {...props}>
        {children}
        {inset && footer == null ? <View style={inset} /> : null}
      </ScrollView>
    );
    if (footer == null) return scroll;
    return (
      <>
        {scroll}
        {fill || inset ? <View style={[fill, inset]}>{footer}</View> : footer}
      </>
    );
  }
);

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
});
