/**
 * The scroll view of a screen under a native stack header.
 *
 * A collapsing large title on iOS only works when the screen's scroll view lets the system inset
 * its content, otherwise the content sits under the title at rest. This sets that once for the
 * routes that take a large title in `screenHeaders`. Android has no such inset, so it gets none.
 * A prop the caller passes wins over the default.
 */

import React, { forwardRef } from 'react';
import { Platform, ScrollView, type ScrollViewProps } from 'react-native';

/**
 * The same default for a screen whose body is a `FlatList` or `SectionList`: spread it onto the
 * list. `lint:large-title-scroll` looks for this name on a list in a large-title route.
 */
export const screenListInsets: Pick<ScrollViewProps, 'contentInsetAdjustmentBehavior'> =
  Platform.OS === 'ios' ? { contentInsetAdjustmentBehavior: 'automatic' } : {};

export const ScreenScrollView = forwardRef<ScrollView, ScrollViewProps>(
  function ScreenScrollView(props, ref) {
    return <ScrollView ref={ref} {...screenListInsets} {...props} />;
  }
);
