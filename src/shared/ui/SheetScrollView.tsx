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
 */

import React, { forwardRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
  type ScrollViewInstance,
} from 'react-native';

type SheetScrollViewProps = Omit<ScrollViewProps, 'style'> & {
  footer?: React.ReactNode;
};

export const SheetScrollView = forwardRef<ScrollViewInstance, SheetScrollViewProps>(
  function SheetScrollView({ footer, ...props }, ref) {
    const scroll = <ScrollView ref={ref} style={styles.sheet} {...props} />;
    if (footer == null) return scroll;
    return (
      <>
        {scroll}
        {footer}
      </>
    );
  }
);

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
});
